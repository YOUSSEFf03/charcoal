# Cash Management System — Specification Peer Review

Reviewing `CASH_MANAGEMENT_ARCHITECTURE_SPEC.md` before implementation. This is a critical review, not a ratification — several conclusions below revise or outright reverse recommendations made in that document. Nothing here is implemented; no source files were touched.

---

## 1. Challenging the Assumptions

**"One `LedgerService` that writes and reads" — wrong bundling.** The spec's §7 gives `LedgerService` both the write surface (`recordCollection`, `recordHandover`, `recordTransfer`, `recordCorrection`) and the read surface (`getBalance`, `getAllBalances`, `getExpectedCash`). That's two responsibilities wearing one name. At today's scale it's harmless; at the stated growth target (30 branches, 500 users, thousands of transactions/day) it becomes the thing every new feature reaches into for both writing and querying, and it will accrete methods from both directions until it's a god service. **Revision: split into a write-only `LedgerWriteService` and a separate `BalanceQueryService`/`CashReportingService`.** This is not a stylistic nit — it's the seam that makes §9's CQRS question answerable later without a rewrite.

**"Holder is a `User` capability" — this does not survive contact with its own §12.** The original spec's Invariant 5 states "a Holder's identity in a Ledger Entry is always a real foreign key to `User.id`," and §12 then claims extending Holder to drawers/safes/vehicles/bank accounts is "additive, not a redesign" because "nothing in the design assumes Holder = person at the primitive level." That claim is false as written: the invariant *explicitly* types Holder as `User.id`. A drawer has no login, no `Role`, no Clerk identity — it cannot be a `User` row without abusing the `User` table for non-people, which is worse than the alternative. **This is a real design flaw, not a future concern — see §5 below for the correction.**

**"Compute balances on demand, add a cache only if needed" — too reactive given the stated targets.** This was defensible advice for the system as it exists today (a handful of holders, a few hundred ledger rows a month). It stops being good advice the moment the spec itself commits to 30 branches and thousands of transactions/day in §14. Retrofitting a read model onto a system that has already grown ad hoc, per-feature caching is exactly the failure mode the whole spec exists to prevent in the *current* codebase (Audit §6/§10 — duplicated, divergent "total collected" calculations). **Revision: design the read/write seam now** (§9), even if the initial "read model" is a trivial live query — the point is the seam existing, not its initial sophistication.

**Is there a simpler architecture?** No — the ledger-as-source-of-truth model is the standard, correct answer for this problem class (append-only double-entry-adjacent accounting), and nothing simpler survives the audit's actual findings (currency mixing, silent balance gaps, untrusted client input). The complexity being challenged here is in the *supporting* decisions (Holder modeling, read/write split, idempotency), not the core ledger decision itself, which should remain.

---

## 2. Service Boundaries

| Service | Verdict | Issue |
|---|---|---|
| `LedgerService` | **Split required** | Bundles write and read responsibilities — see §1. |
| Receiver Resolution | **Wrong layer** | The original spec frames this as a shared frontend hook / helper. That doesn't enforce anything — a direct API call (Postman, a future mobile app, a bug in a *different* frontend page) bypasses a frontend helper entirely. **Revision: holder validation must happen inside `LedgerWriteService.recordCollection` itself** (does this holder exist, are they active, are they cash-capable) — server-side, unconditionally, regardless of what any frontend sends. A shared frontend helper is still worth having for UX, but it is not the enforcement mechanism. |
| `CashHandoverService` | **Correctly scoped** | Thin orchestrator: reads expected via the query service, writes via the ledger write service, owns only the `CashHandover` record itself. No changes recommended. |
| `PaymentService` / `WarehouseSaleService` / `StockExitService` | **Mostly correct, one hidden coupling** | None of them write ledger rows directly (good — this was the audit's core finding, and the spec fixes it). But each must tell the ledger *what kind of thing* caused the collection (a Payment? a StockExit?), which means the ledger has to know about every possible source type. The original spec waves this away as "replace `referenceId` with a proper typed reference" without picking a mechanism. **This is an unresolved tradeoff, not a solved one:** a generic `referenceType` enum + `referenceId` string recreates the exact "unenforced reference" problem the audit criticized in the *current* system; true per-type nullable FK columns (`paymentId`, `stockExitId`, `cashHandoverId`, `cashTransferId`, one populated per row) give real DB-enforced integrity at the cost of a new nullable column every time a new collection source is added. **Recommendation: adopt the nullable-FK-per-source-type pattern explicitly** — it costs a migration per new source type, which is an acceptable, infrequent price for keeping referential integrity real instead of stringly-typed. |

**God services:** none outright, but `LedgerService` as originally scoped was heading there (§1). **Circular dependencies:** none found — the dependency graph is a clean DAG (business services → ledger service; nothing calls back). **Hidden coupling:** the reference-type problem above is the one real instance.

---

## 3. Business Concepts

- **"Outstanding Cash" and "Cash Balance" are the same thing with two names.** The original spec defines them as literal synonyms. That's not a complete concept, it's redundant terminology. **Revision: retire "Outstanding Cash," keep "Cash Balance."** If a future need arises to distinguish "raw ledger balance" from "balance net of disputed/pending corrections," that's the moment to reintroduce a second term with an actual distinct meaning — not before.
- **Missing: Opening Float / Opening Cash.** Real cash-handling operations often give a holder a starting float (e.g., $50 kept in a drawer to make change) that is explicitly *not* meant to be handed over at day's end. The original spec has no concept of this — every ledger balance implicitly starts at zero and every collected dollar is treated as fully owed back. If this business uses (or will use) a float, the architecture needs a distinct entry type (`opening_float`) that increases a holder's balance without being "money collected on the business's behalf" in the same sense — otherwise "expected cash" at handover time will always overstate what should actually come back.
- **Missing: Cash Count / Reconciliation Session, as distinct from Handover.** The spec collapses "count what a holder has" and "transfer custody of it" into one event (Handover). A real operation often wants a spot-check count *without* moving custody (an audit, a shift-change verification). Recommend a lighter-weight `CashCount` event (produces no ledger entries, just an Expected-vs-Counted comparison for visibility) as a distinct concept from `CashHandover` (which does move custody and does post ledger entries).
- **"Correction" as a competing type vs. a modifier — underspecified.** The spec gives Correction its own entry type, parallel to Collection/Handover/Transfer. But a correction is always *correcting something* — a mis-recorded collection, a handover shortage, a bad transfer. If reporting ever needs to answer "how many corrections were collection-errors vs. handover-shortages," a single flat `correction` type can't answer that. Recommend corrections carry a reference to *what kind* of entry they're correcting (already implied by the `referenceId`, but the `type` itself should probably be `handover_shortage` / `handover_overage` / `collection_correction` / `transfer_correction` rather than one generic bucket — the spec's own §6 for Handover actually already proposes `handover_shortage`/`handover_overage` as distinct types, which contradicts §1's single generic "correction" type elsewhere in the same document. **This inconsistency should be resolved in favor of specific, reporting-friendly types.**
- **"Advance" is modeled backwards.** The original spec treats an advance as a credit entry to the holder — the same sign as a collection. But an advance is conceptually the *opposite* of a collection: it's money the business gives the holder to spend, not money the holder collected on the business's behalf. Merging both into one "cash balance owed back" figure means a $500 balance could mean "this person is holding $500 of the business's sales revenue" or "we gave this person a $500 fuel advance" — two completely different real situations that would be indistinguishable in reporting. **Recommendation: advances should track against a separate balance dimension** ("advance outstanding," reconciled against actual expenses as they're recorded) rather than being folded into the same "cash collected, owed back" ledger dimension.

---

## 4. Ledger Architecture — Revised

- **Should `LedgerService` only write entries?** Yes — per §1/§2, split into a write-only service and a separate query service.
- **Should balance calculation live elsewhere?** Yes, in the query/reporting service, not the write service.
- **Would CQRS improve this?** Yes, and it should be adopted as the target shape now (§9), not deferred.
- **Should `LedgerEntry` support versioning?** Individual entries never mutate, so entry-level versioning is meaningless. What *should* carry a version is any read-model projection (a cached balance, a materialized view) — it should know "as of which entry" it's current, so staleness is detectable rather than silent.
- **Should idempotency be built in? Could duplicates occur? How should retries behave?** This is the single largest gap in the original specification — **idempotency is not mentioned anywhere in it.** Concretely, without it: a double-clicked "Confirm handover" button, a network timeout that causes a frontend retry, or a driver's app resyncing after connectivity returns can each produce two ledger entries for one real-world event. **Recommendation:** every write-inducing business operation (create Payment, create WarehouseSale, create CashHandover, create CashTransfer) accepts a client-generated idempotency key, enforced by a unique constraint on the resulting business document (not on the ledger entry directly). Because the ledger entry is written in the same transaction as that document, idempotency at the document level gives idempotency at the ledger level for free — this is the correct layer to enforce it at, not inside `LedgerWriteService` itself, which should trust that it's only ever called once per real event because its caller already deduplicated.

---

## 5. Cash Holder Architecture — Reversed Recommendation

The original spec's decision — Holder as a `User` capability, with non-person holders deferred as "an interface with two kinds" — does not hold up. A dedicated `CashHolder` entity is the correct design, and should be adopted **now**, not deferred:

```
CashHolder
  id
  type        (person | drawer | safe | vehicle | bank_account | branch)
  userId?     (FK → User, populated only when type = person)
  label       (display name — the person's name, or "Main Safe", "Truck 3", etc.)
  branchId?   (future — which location this holder belongs to)
  active
```

Every Ledger Entry references `CashHolder.id`, never `User.id` directly. A person-holder is simply a `CashHolder` row with `type=person` and a populated `userId`. This is strictly simpler in the long run: one consistent foreign key everywhere, no "is this holder a person or something else" special-casing scattered across every service that touches the ledger, and no later migration to retrofit non-person holders into a model that was never designed for them.

**Would this reduce future migrations?** Significantly. Under the original person-only model, adding a drawer or a bank account later means either (a) creating a fake `User` row for it (a real anti-pattern — auth/role/Clerk concerns bleeding into a concept that has nothing to do with authentication), or (b) a genuine schema migration to introduce a polymorphic reference after the fact, touching every existing Ledger Entry row. Introducing `CashHolder` now costs one extra join today and saves a disruptive migration later.

---

## 6. Money Flow — Missing Flows

- **Supplier refunds / outbound supplier cash payments.** The existing codebase already has `SupplierPayment` (money flowing *to* suppliers) — a direction the original spec never considered at all, having focused entirely on inbound client/sale cash. If an owner or accountant ever pays a supplier in physical cash drawn from a holder's float, that's a *debit* against a Cash Holder with no corresponding "collection" — it needs its own flow (or should reuse Transfer/Correction machinery explicitly, rather than being silently unsupported).
- **Opening cash / closing cash.** Missing as both a concept (§3) and a flow — assigning a starting float, and a shift-close reconciliation that doesn't necessarily hand over 100% of cash.
- **Cash adjustments.** Almost certainly the same thing as "Correction" under a different label — worth explicitly stating they're one concept, not proposing a new type, to prevent implementation drift where someone builds both.
- **Bank deposits.** Partially addressed ("a Handover to 'the bank' is the same primitive"), but incompletely: a deposit from a *drawer* straight to a bank, with no person-holder in between, needs the Holder generalization from §5 to be expressible at all under the original person-only model. Once `CashHolder` exists, this is just a Transfer where the destination `CashHolder.type = bank_account` — no new flow needed, but this only works after the §5 revision.
- **ATM withdrawals.** Same resolution as above — a Collection where the source is a `bank_account`-type holder and the destination is a person/drawer holder. Not addressed at all in the original spec; resolved for free once §5 is adopted.
- **Internal cash movements (safe → drawer for the day).** Also resolved for free once §5 is adopted — this is simply a Transfer between two `CashHolder` rows.

---

## 7. Transactions

- **Must be atomic:** the business document (Payment/StockExit/CashHandover/CashTransfer) and its Ledger Entry, in one `$transaction` — unchanged from the original spec, and correct.
- **Can be async:** a read-model/projection update, *if and only if* §4/§9's CQRS revision is adopted. The write-side ledger entry itself must remain synchronous.
- **New partial-failure surface introduced by this revision:** an async read-model can lag or fail to update. This must be paired with a required (not optional) reconciliation job that rebuilds the read model from the ledger on a schedule and on demand — the original spec proposed this as a "nice to have" safety net; it becomes a **required component** the moment any asynchronous projection exists, not an afterthought.

---

## 8. Idempotency — Concrete Strategy

(Expanded from §4.) Recommend:
1. Every client-triggered write operation generates one idempotency key per user action (a UUID created once, client-side, when the user clicks "Confirm" — not regenerated on retry).
2. The resulting business document (`Payment`, `StockExit`/`Invoice`, `CashHandover`, `CashTransfer`) stores that key under a unique constraint.
3. A retried request with the same key returns the original result (or a clean "already processed" response) instead of creating a second document — and therefore a second ledger entry.
4. `LedgerWriteService` itself does **not** need independent idempotency logic — it can trust that it is only ever invoked once per real event, because deduplication already happened one layer up, at the business-operation boundary. This keeps the ledger primitive simple, which matters more as more source types are added (§2).

---

## 9. Read Model — CQRS Recommendation

The original spec is write-focused and treats the read side as an implementation detail ("compute live, cache if needed later"). **Revision: adopt CQRS-lite as the target architecture explicitly, now:**
- **Write model:** `LedgerEntry` table, normalized, transactional, append-only, owned exclusively by `LedgerWriteService`.
- **Read model:** one or more query-optimized projections (a `CashHolderBalance` summary table, per-holder-per-currency; a reporting aggregate for date-range totals), owned exclusively by `BalanceQueryService`/`CashReportingService`.
- **Initial implementation of the read model can be a live query** (a `SUM(...) GROUP BY holder, currency` view) — that's fine at current scale and satisfies the seam without extra engineering cost today.
- **The seam is what matters:** because the read model is architecturally separate from day one, it can later become a materialized view, a scheduled batch projection, or a fully separate read-replica-backed service — without touching the write side or any of the business services that call it.
- Materialized views / caches should exist **only** behind this seam, never as an ad hoc column bolted onto a business table (which is exactly the anti-pattern the original audit found and the original spec's `UserAccount.balance` column risked perpetuating).

---

## 10. Reporting — Not Everything Comes From the Ledger

The original spec's §11 implies Dashboard/Reports/Activity Feed should all route through the ledger service. **This needs correction: only the cash-specific figures should.** The cash ledger answers exactly one question well — "who is physically holding how much cash, and what's its history." It does **not**, and should not be forced to, answer:
- **Revenue/P&L** — deliberately accrual-based in this business (`Invoice.total` at issuance, per the audit's reading of `ReportsService.getProfitLoss()`), a fundamentally different question from cash custody. A bank-transfer-paid invoice never touches the cash ledger at all and must still count as revenue.
- **Accounts receivable (what clients owe)** — already a separate, correctly-designed on-the-fly computation (`ClientBalanceService`) that has nothing to do with who's physically holding cash.
- **COGS, worker costs, container/supplier costs** — unrelated to cash custody entirely.

**Revision:** "total cash currently held across all holders," "total collected in range," and "total handed over in range" should be the *only* figures required to route through the shared cash-reporting layer (closing the audit's Dashboard-vs-Reports inconsistency). Revenue, AR, and cost reporting correctly remain separate, purpose-built aggregations — forcing them through the cash ledger would be a modeling error, not an improvement.

---

## 11. Currency — Gaps in the Original Strategy

- **Is `exchangeRateSnapshot` sufficient?** Only if there is exactly one rate source, which matches today's `SettingsService.getExchangeRate()` — a single global scalar. This is a real risk if the business ever needs multiple concurrent rate sources (e.g., an official bank rate vs. a parallel-market rate — a genuinely common situation in Lebanon), since the snapshot as designed records a number, not *which rate it came from*. **Revision: the snapshot should record a reference to a rate-source record, not a bare number**, so multi-source support is possible without another migration.
- **Should conversion services exist?** Yes — a dedicated `CurrencyConversionService` should be the *only* place that resolves "the rate at time T" and performs currency conversion, rather than every report independently writing its own `CASE WHEN currency = 'LBP'` SQL (exactly the pattern the audit found repeated across `reports.service.ts`). This was implied but not explicitly named in the original spec.
- **Should exchange rates be immutable?** The *historical record* of what the rate was at a point in time must be immutable — but this exposes a real dependency the original spec didn't flag: today, `Setting.exchangeRate` (per the audit) is a single mutable row, presumably just overwritten on change, with no history of its own. **The entire snapshot strategy is only as trustworthy as the rate history it's stamping from — and that history doesn't currently exist.** Recommend an explicit `ExchangeRateHistory` (rate, effective-from timestamp, set-by user) as a prerequisite for the cash ledger's currency strategy to be verifiable at all, not merely assumed correct.
- **Future currencies:** the per-currency model (unchanged from the original spec) already generalizes to any number of currencies without a schema change — this part of the original design holds and should remain.

---

## 12. Security — Refinements

- **Who creates ledger entries?** Nobody, directly — this should be stated as an explicit architectural rule, not left implicit: there is no API surface that creates a raw `LedgerEntry`; entries are always a side effect of a real business operation (Payment, Sale, Handover, Transfer, Correction). The original spec implies this but never states it as a hard constraint.
- **Who reverses entries?** `owner` only (unchanged) — with a forward-looking refinement worth naming: at the stated 30-branch/500-user scale, a second-approver ("four-eyes") requirement for reversals above a threshold amount is worth designing room for, even if not needed on day one.
- **Who archives holders?** `owner` only (unchanged).
- **Who reopens handovers?** This question, raised by the review prompt, exposes something the original spec never addressed explicitly. Recommendation: handovers are **never reopened** — a mistaken handover is corrected by posting a new, linked correcting entry (and, if needed, a new corrected handover record), never by mutating the original. This should be stated as an explicit rule rather than left to be inferred from "entries are immutable."
- **Who edits historical data?** Nobody, ever — full stop, at the API layer at minimum. At larger scale, this is worth reinforcing with database-level write permissions on the ledger table (append/insert only, no update/delete grants), not just application-layer discipline.
- **Who views balances?** The original spec's `owner`/`accountant`-see-everyone, holder-sees-own-only model is too coarse for the 30-branch future — a branch manager should plausibly see their branch's holders without seeing every other branch's. Recommend a branch/location-scoped view permission as a forward-looking revision, which becomes natural once `CashHolder` carries a `branchId` (§5).

---

## 13. Operational Concerns

- **Network interruption, double-clicking, browser refresh:** directly addressed by the idempotency-key strategy (§8) — this was entirely missing from the original spec.
- **Offline devices:** not addressed at all originally, and worth flagging given `driver` is already a role with mobile delivery routes in this business. An offline-capable flow needs to distinguish **event time** (when the cash was actually collected, possibly while offline) from **recorded time** (when it synced to the server) — the original spec's single `date` field per entry doesn't make this distinction. Recommend both fields exist on every entry once offline support is ever needed.
- **Concurrent users:** already reasoned about correctly in the audit — Postgres `increment`/`decrement` inside a transaction serializes correctly at the row level. This holds and needs no change.
- **Clock differences / timezone issues:** the existing schema leans on `@db.Date` (date-only, no timezone) for most date fields. Fine for a single-timezone business today; ambiguous the moment branches might span timezones — "which calendar day does this entry belong to" becomes a real question. Recommend the ledger's own timestamp be a true UTC instant, with a separately-derived "business date" used only for reporting grouping, rather than relying on a bare date column as the primary time reference.
- **Large ledgers:** an index on `(holderId, currency, date)` at minimum; table partitioning by date range becomes a realistic need at "thousands of transactions/day" sustained over years — worth planning for, not urgent today.
- **Database recovery / backup restoration:** genuinely a **strength** of this design worth stating explicitly — because the ledger is the sole source of truth and everything else (balances, reports) is derived, restoring the ledger table plus its referenced source documents is sufficient to reconstruct all balances and history exactly. Nothing here needs to change.
- **Manual SQL changes:** this deserves an honest answer, not an idealized one — this very session performed direct database surgery on this codebase (correcting malformed seed UUIDs) because it was the right tool for that job. An architecture that assumes nobody will ever run raw SQL against production is unrealistic. **Recommendation: any legitimate manual intervention on the ledger should itself insert a compensating entry tagged with a `source = manual_intervention` marker and a required reason**, rather than the architecture pretending direct DB access will never happen.

---

## 14. Scalability at 30 Branches / 500 Users / Thousands of Transactions per Day

- `getAllBalances()` as originally sketched (a single unfiltered `findMany` across every holder) does not survive this scale — it needs branch/role/search scoping built into the query from the start, not fetched-then-filtered client-side.
- Live `SUM`-based balance computation over a ledger that could reach millions of rows over years needs, beyond indexing: a **period-close checkpoint** mechanism — a periodic, audited "balance carried forward as of end-of-month X" record — so routine balance queries don't `SUM` from the beginning of history. This is not a violation of the append-only principle; a checkpoint is itself just another immutable, auditable record, not a mutation of anything.
- Payment gateways and bank integrations are, architecturally, just new "collection source" types feeding `LedgerWriteService.recordCollection` — the design accommodates this cleanly **provided** the §2 reference-type tradeoff is resolved (nullable per-type FK columns), since a gateway integration will want the same referential integrity guarantee every other source gets.
- Multi-currency at this scale sharpens the §11 concern: different branches or currencies may reasonably need different rate sources concurrently, reinforcing that recommendation rather than introducing a new one.

---

## 15. Final Verdict

### Strengths (keep unchanged)
- The core decision: one append-only Ledger Entry table as the single source of truth for cash custody, with all balances derived rather than trusted as input.
- Business documents (Payment, StockExit, CashHandover, CashTransfer) and their Ledger Entry always written in one atomic transaction.
- Server-computed "Expected Cash" at handover time, never accepted from the client.
- Per-currency balances with a rate snapshot per entry, rather than converting/mixing at write time.
- The insight that Dashboard/Reports/AR-summary currently diverge because they each reimplement the same aggregation differently, and the fix is one shared query layer.
- The recognition that receiver resolution must not be duplicated independently across every frontend page.
- The backup/recovery property that falls out of an append-only design for free.

### Weaknesses (fix before implementation)
1. `LedgerService` bundles write and read responsibilities — split them (§1, §2, §9).
2. Holder modeled as a `User` capability, contradicted by the spec's own multi-holder-type future — introduce a dedicated `CashHolder` entity now (§5).
3. No idempotency strategy anywhere in the original spec (§4, §8).
4. Reference from Ledger Entry to its source document left as a vague "typed reference" with an unresolved integrity tradeoff (§2).
5. Currency snapshot assumes a single rate source with no historical audit trail of rate changes (§11).
6. Reporting section implies everything should route through the ledger, which is incorrect for revenue/AR/cost reporting (§10).
7. No distinction between event-time and recorded-time on ledger entries (needed the moment offline collection is supported) (§13).

### Missing Features
- Opening float / opening cash assignment (§3, §6).
- Cash count / reconciliation session distinct from a full handover (§3).
- Supplier-directed outbound cash flows from a holder's float (§6).
- A dedicated currency-conversion service and an auditable exchange-rate history (§11).
- Explicit "no reopening handovers, only reverse-and-supersede" rule (§12).

### Architectural Risks
- Retrofitting `CashHolder` after non-person holders have already been bolted onto `User` would be a disruptive migration touching every existing ledger row — this is the single highest-cost risk if not corrected before implementation.
- Skipping idempotency design now means the first production double-submission bug will need to be fixed under real financial-data pressure rather than designed calmly in advance.
- Treating the read side as an afterthought risks reproducing the exact "everyone computes their own version of the same number" problem the audit already found once, just in a new location.
- Assuming a single global exchange rate with no history makes the entire currency-correctness story unverifiable in an audit, even though the numbers might happen to be right.

### Recommended Revisions to the Specification
1. Split `LedgerService` into `LedgerWriteService` + `BalanceQueryService`/`CashReportingService`.
2. Replace "Holder = User capability" with a dedicated `CashHolder` entity (optional `userId` for person-holders; `type` for drawer/safe/vehicle/bank_account/branch).
3. Add an explicit idempotency-key requirement to every write-inducing business operation, enforced at the business-document layer, not the ledger primitive.
4. Resolve the source-reference tradeoff explicitly in favor of nullable per-type foreign keys on `LedgerEntry`.
5. Adopt CQRS-lite as the stated target shape now, with the read side allowed to start as a live query behind the same seam.
6. Scope §10/§11 (reporting, currency) precisely: only cash-custody figures route through the ledger/reporting layer; revenue/AR/cost reporting remain separate; add a `CurrencyConversionService` and an `ExchangeRateHistory` as prerequisites the currency strategy depends on.
7. Add Opening Float, Cash Count/Reconciliation, and explicit Handover-is-never-reopened as named concepts/rules in the specification.

---

*This review evaluates the specification only. It does not alter it — see `CASH_MANAGEMENT_ARCHITECTURE_SPEC.md` for the document under review, and `RECEIVER_BALANCE_CASH_HANDOVER_AUDIT.md` for the original findings both documents build on. No files were modified to produce this review.*
