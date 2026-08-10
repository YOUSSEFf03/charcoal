# Cash Management System — Final Implementation Blueprint

**Status: authoritative.** This document supersedes `RECEIVER_BALANCE_CASH_HANDOVER_AUDIT.md`, `CASH_MANAGEMENT_ARCHITECTURE_SPEC.md`, and `CASH_MANAGEMENT_SPEC_REVIEW.md`. Those three remain on disk as historical record of how this design was reached, but wherever they conflict with this document, **this document wins**. No further architecture discussion should be needed before implementation begins — every open question below has one final answer.

No code was written or modified to produce this document.

---

## 0. Executive Summary

The business currently has no real cash-custody ledger — it has three services independently calling two loose helper functions, a receiver-selection UI that works correctly in exactly one of four places, a balance column with no currency, and a handover process that trusts client-computed numbers. This blueprint replaces all of that with:

- A dedicated **`CashHolder`** entity (not a `User` capability) representing anyone or anything that can physically hold cash — people, drawers, safes, vehicles, bank accounts, or branches.
- A single **`LedgerEntry`** table — append-only, per-currency, rate-stamped, referentially real (nullable per-source-type foreign keys, never a bare string) — as the one and only source of truth for cash custody.
- A **`LedgerWriteService`** that is the *only* code allowed to create ledger rows, and a separate **`BalanceQueryService`** / **`CashReportingService`** that is the *only* code allowed to answer "how much does X hold" — a clean CQRS seam from day one, even though the read side starts as a live query.
- A **`CurrencyConversionService`** backed by an append-only **`ExchangeRateHistory`**, replacing today's single mutable rate setting.
- A **Cash Handover** process that computes "expected" itself from the ledger and never accepts it from the client, with expenses recorded as real ledger transactions when they happen rather than invented at handover time.
- Idempotency keys on every write-inducing operation, enforced at the business-document layer.
- A phased migration path with zero big-bang deployment, starting from the exact system the audit examined.

Everything below is the single final decision on every point the three prior documents debated.

---

## 1. Resolved Conflicts

| Conflict | Option A | Option B | **Final decision** | Why |
|---|---|---|---|---|
| Holder identity | `User` capability (audit/spec) | Dedicated `CashHolder` entity (review) | **`CashHolder`, dedicated entity** | A drawer, safe, or vehicle has no login and cannot be a `User` without abusing the auth model. Retrofitting this later means migrating every historical ledger row. Cheaper to pay one extra join now than a disruptive migration later. |
| Ledger service shape | One `LedgerService` (read + write) | Split write/read (review) | **Split: `LedgerWriteService` + `BalanceQueryService`** | Bundling both in one class is exactly how god-services form as more entry types and reports get added. Splitting now costs nothing and is the seam CQRS needs later. |
| Balance calculation | Cached column, incremented/decremented | Computed live from the ledger | **Computed live, by default, through `BalanceQueryService` only** | The current bug pattern (stale/incorrect balances) comes specifically from a cached column that multiple call sites could touch. Removing the cache removes the bug class. Performance is addressed separately via checkpoints (§6 in Ledger Design, §11 Scalability), not by resurrecting an ad hoc cache. |
| Cached vs. computed | — | — | **Computed is the source of truth, always.** A checkpoint (period-close snapshot) may exist purely as a performance optimization *of the same computation*, written only by `BalanceQueryService`'s own reconciliation job — never as an independently-writable value. |
| Entry references | Generic `referenceType` + `referenceId` string | Nullable per-source-type foreign keys | **Nullable per-type FKs** (`paymentId`, `stockExitId`, `cashHandoverId`, `cashTransferId`, `cashAdvanceId`, `supplierPaymentId` — one populated per row, DB check constraint enforces exactly one) | A generic string reference recreates the exact "unenforced reference" defect the original audit found in today's system. Real foreign keys cost one column per new source type — an acceptable, infrequent price for actual referential integrity. |
| Correction entries | One generic `correction` type | Specialized types per correction target | **Specialized types**: `handover_shortage`, `handover_overage`, `collection_correction`, `transfer_correction`, `manual_intervention` — all sharing one behavioral contract (references the entry/document being corrected, mandatory reason, `owner`-only) | Reporting needs to distinguish *what kind* of correction occurred; a flat bucket can't answer that. The shared behavioral contract (not a shared literal type value) is what keeps validation/permission logic uniform. |
| Idempotency location | Not addressed originally | Inside `LedgerWriteService` vs. at the business-document layer | **Business-document layer** (`Payment`, `StockExit`/`Invoice`, `CashHandover`, `CashTransfer`, `CashAdvance` each carry a unique client-generated idempotency key) | The ledger entry is written in the same transaction as its business document — deduplicating the document deduplicates the ledger effect for free. `LedgerWriteService` stays simple by trusting it's only ever called once per real event. |
| Advance modeling | Same signed dimension as collections | Separate balance dimension | **Separate dimension**: every `LedgerEntry` carries a `category` of `CUSTODY` (cash collected on the business's behalf, owed back) or `ADVANCE` (cash given to a holder for their own spending, reconciled against expenses) | Mixing the two makes a large balance ambiguous — "holding sales revenue" and "given a fuel advance" must never look identical in a report. |
| Reporting scope | Everything routes through the ledger | Only cash-custody figures do | **Only cash-custody figures** (who holds how much, collected/handed-over totals) route through `CashReportingService`. Revenue (accrual), accounts receivable, and cost reporting remain separate, existing aggregations. | The ledger answers "who is holding cash," not "how much has the business earned." Forcing revenue/AR through it would be a modeling error, not a fix. |
| Exchange rate model | Single mutable `Setting.exchangeRate`, bare snapshot number | `ExchangeRateHistory` + a rate-source reference on each entry | **`ExchangeRateHistory`, append-only, entries reference a specific history row, not a bare number** | A bare snapshot is only as trustworthy as the (currently nonexistent) history behind it, and can't support more than one concurrent rate source (e.g. official vs. parallel-market rate) without another migration. |
| Handover reopening | Not addressed / implied editable | Never reopened vs. reversible | **Never reopened. Always reverse-and-supersede.** | Keeps the immutability invariant absolute; a correcting entry plus a new, correct handover record is strictly more auditable than mutating history. |
| Manual SQL intervention | Assumed not to happen | Assumed to happen, needs a convention | **Assumed to happen.** Every manual DB fix to the ledger must be paired with a `manual_intervention`-typed compensating entry and a mandatory reason. | This session already performed legitimate direct-DB surgery on this codebase. Pretending it will never happen again is unrealistic; the architecture instead makes it auditable when it does. |
| Event time vs. recorded time | One `date` field | Two fields (`occurredAt`, `recordedAt`) + derived business date | **Two fields, plus a derived `businessDate`** | Needed the moment any offline collection (e.g. a driver's app) exists — the event can happen before it syncs. Resolved now so it isn't a breaking schema change later. |

---

## 2. Final Domain Model

### `CashHolder`
**Purpose:** anyone or anything that can physically hold cash on the business's behalf.
**Responsibilities:** identity + classification for every ledger entry's holder side; nothing else — it does not store a balance.
**Relationships:** optional 1:1 to `User` (when `type = person`); optional `branchId` (future, §11); referenced by every `LedgerEntry`, `CashHandover`, `CashTransfer`, `CashAdvance`, `OpeningFloat`, `CashCount`.
**Key fields (conceptual):** `id`, `type` (`person | drawer | safe | vehicle | bank_account | branch`), `userId?`, `label`, `branchId?`, `active`.
**Lifecycle:** Created → Active (selectable everywhere) → Deactivation requested → blocked if any nonzero balance in any currency/category exists → Deactivated (excluded from new selection, full history retained) → hard delete permitted only when zero `LedgerEntry` rows reference it (rare).

### `LedgerEntry`
**Purpose:** the atomic, immutable record of one cash movement. The system's single source of truth.
**Responsibilities:** record amount, currency, category (`CUSTODY`/`ADVANCE`), type, exactly one source-document reference, the exchange-rate-history reference used, `occurredAt`, `recordedAt`, `recordedBy`.
**Relationships:** `holderId → CashHolder`; exactly one of `paymentId / stockExitId / cashHandoverId / cashTransferId / cashAdvanceId / supplierPaymentId` populated; `exchangeRateHistoryId → ExchangeRateHistory`; corrections additionally reference the entry/document they correct.
**Lifecycle:** Created once, by `LedgerWriteService`, inside the same transaction as its source document. Never updated. Never deleted.

### `ExchangeRateHistory`
**Purpose:** append-only record of what the LBP/USD (and any future pair) rate was, when, and from which source.
**Responsibilities:** provide the historically-correct rate for any past `LedgerEntry`; provide the current rate for live reporting.
**Relationships:** referenced by `LedgerEntry.exchangeRateHistoryId`; written exclusively by `CurrencyConversionService`.
**Key fields:** `id`, `currencyPair`, `rate`, `sourceType` (`official | parallel | ...`), `effectiveFrom`, `setByUserId`, `createdAt`.
**Lifecycle:** Created on every rate change. Never updated or deleted — a "correction" to a rate is a new row with a later `effectiveFrom`.

### `CashHandover`
**Purpose:** the historical record of a holder depositing their held cash into company custody.
**Responsibilities:** store the server-computed Expected Cash *snapshot*, the human-entered Actual Cash, the Difference, notes, who confirmed it, when.
**Relationships:** `holderId → CashHolder`; produces one or two `LedgerEntry` rows (`cashHandoverId` reference) — a debit for Actual, plus a correction entry (`handover_shortage`/`handover_overage`) if Difference ≠ 0.
**Lifecycle:** Created once via `CashHandoverService.confirm()`. Never updated or deleted. Never reopened — a mistake is corrected by a new correction entry and, if needed, a new `CashHandover` record.

### `CashCount`
**Purpose:** a lightweight spot-check — count what a holder has *without* moving custody.
**Responsibilities:** store Expected (computed) vs. Counted (human-entered), for visibility/audit only.
**Relationships:** `holderId → CashHolder`. Produces **no** `LedgerEntry` rows — it does not move money, it only observes it.
**Lifecycle:** Created freely by anyone permitted to view balances; purely informational, never referenced by anything else.

### `OpeningFloat`
**Purpose:** the starting cash a holder is given to make change, which is *not* expected to be handed back in full.
**Responsibilities:** record the float amount, currency, holder, and date assigned.
**Relationships:** `holderId → CashHolder`. Produces one `LedgerEntry` (`category = CUSTODY`, `type = opening_float`) — it does increase the holder's custody balance, but `BalanceQueryService.getExpectedCash()` treats float-typed entries as a standing baseline the holder is allowed to retain, not as newly-collected cash owed back (concretely: expected-for-handover = current custody balance **minus** any still-active opening float assigned to that holder).
**Lifecycle:** Created when a float is assigned; superseded (not edited) if the float amount changes — a new `OpeningFloat` record plus an offsetting `LedgerEntry` reverses the old one.

### `CashTransfer`
**Purpose:** cash moving from one `CashHolder` to another without leaving the business's custody boundary.
**Responsibilities:** record `fromHolderId`, `toHolderId`, amount, currency, reason, date, initiated by.
**Relationships:** produces **two** linked `LedgerEntry` rows (debit `fromHolder`, credit `toHolder`), same transaction, both referencing this one `CashTransfer` row (`cashTransferId`).
**Lifecycle:** Created once via `CashTransferService`. Never updated or deleted; a mistaken transfer is corrected by a new, reversing `CashTransfer`.
**Note:** Bank deposits and ATM withdrawals are **not** separate entities — they are `CashTransfer` rows where one side's `CashHolder.type = bank_account`.

### `CashAdvance`
**Purpose:** cash given *to* a holder for their own spending (fuel, supplies), not collected on the business's behalf.
**Responsibilities:** record holder, amount, currency, reason, date, issued by.
**Relationships:** produces one `LedgerEntry` (`category = ADVANCE`, `type = advance_given`, `cashAdvanceId` reference). Reconciled later against real `GeneralExpense`/`WorkerCost` records — reconciliation is a reporting-side comparison, not a ledger-side mutation.
**Lifecycle:** Created once. Never updated or deleted.

### Correction — not a separate entity
A "correction" is not its own table. It is a specially-typed `LedgerEntry` (§1) referencing whatever it corrects. This avoids a redundant table while remaining fully auditable through the entry's own reference field and mandatory reason.

### Refund — not a separate entity
Modeled as one of two existing mechanisms depending on method:
- **Cash refund** (physical cash leaves a holder's float back to the client): a debit `LedgerEntry` (`type = refund`) referencing the original `Payment`.
- **Accounting-only credit note** (no cash moves): purely an `Invoice`/`Client`-layer adjustment via the existing `ClientBalanceService` logic — never touches the cash ledger, exactly like a `bank_transfer` payment never does.

### Existing business documents (unchanged in shape, changed in behavior)
`Payment`, `Invoice`, `StockExit`, `SupplierPayment` remain exactly what they are today — the accounting-layer documents. What changes is that **none of them ever write to `CashHolder`/`LedgerEntry` directly**; they call `LedgerWriteService` and receive back a reference, exactly as `Payment`/`StockExit`/`WalkInSalesService` today call the (soon to be retired) `creditAccount`/`debitAccount` helpers.

---

## 3. Final Service Architecture

### `LedgerWriteService`
**Responsibilities:** the *only* code path permitted to insert a `LedgerEntry` row. Validates the holder exists and is active; resolves and stamps the `ExchangeRateHistory` reference via `CurrencyConversionService`; enforces the exactly-one-source-reference rule; never computes or exposes a balance.
**Allowed dependencies:** `CashHolderService` (validation), `CurrencyConversionService` (rate stamping), Prisma transaction client passed in by the caller.
**Forbidden:** reading/returning balances, currency conversion arithmetic of its own, any business logic about *why* an entry is being written (that belongs to its caller).
**Public operations:** `recordCollection`, `recordHandover`, `recordTransfer` (writes the linked pair), `recordCorrection`, `recordAdvance`, `recordOpeningFloat`.

### `BalanceQueryService`
**Responsibilities:** the *only* code path permitted to answer "what does holder X currently hold." Computes balances live from `LedgerEntry` (optionally accelerated by a `LedgerCheckpoint`, §5); computes Expected Cash for a handover (custody balance minus any active opening float).
**Allowed dependencies:** read-only Prisma queries against `LedgerEntry`/`LedgerCheckpoint`.
**Forbidden:** writing anything, ever.
**Public operations:** `getBalance(holderId, currency, category)`, `getAllBalances(filters)`, `getExpectedCash(holderId, currency)`.

### `CashReportingService`
**Responsibilities:** business-wide cash aggregates for Dashboard/Reports/Activity Feed — "total collected in range," "total handed over in range," currency-converted totals across all holders.
**Allowed dependencies:** `BalanceQueryService` (composes it — never the reverse), `CurrencyConversionService`.
**Forbidden:** answering revenue/AR/cost questions — those remain the responsibility of `ReportsService`/`ClientBalanceService` unchanged.
**Public operations:** `getTotalCollected(dateRange, conversionMode)`, `getTotalHandedOver(dateRange)`, `getAllHolderSummaries()`.

### `CurrencyConversionService`
**Responsibilities:** the *only* writer of `ExchangeRateHistory`; resolves "the rate at time T for source S"; performs all conversion arithmetic.
**Allowed dependencies:** none beyond its own table.
**Forbidden:** any other service performing its own `CASE WHEN currency = 'LBP'` conversion logic — every such calculation, anywhere in the codebase, routes through this service.
**Public operations:** `getCurrentRate(sourceType)`, `getRateAt(timestamp, sourceType)`, `convert(amount, fromCurrency, toCurrency, rateReference)`, `recordRateChange(rate, sourceType, setByUserId)`.

### `CashHolderService`
**Responsibilities:** CRUD and lifecycle for `CashHolder` (create person/drawer/safe/etc., deactivate with the balance-check rule from §2, search/list). Owns the server-side authority for "does this holder exist and can it currently be selected" — this is the enforcement layer the prior review flagged as missing.
**Allowed dependencies:** its own table, `BalanceQueryService` (to check balance-is-zero before allowing deactivation).
**Forbidden:** writing `LedgerEntry` directly.
**Public operations:** `create`, `deactivate`, `reactivate`, `findAll`, `findOne`, `validateActiveHolder(holderId)` (called by `LedgerWriteService` and every business service before it delegates a collection).

### Receiver resolution — not a standalone backend service
There is no `ReceiverResolver` service. Authority lives inside `CashHolderService.validateActiveHolder()`, called by `LedgerWriteService` on every write — this is enforced server-side regardless of caller. A shared **frontend** hook (turning a picked name into a `CashHolder.id`) exists purely for UX convenience across pages; it has no authority and is not where correctness is guaranteed.

### `CashHandoverService`
**Responsibilities:** thin orchestrator. Calls `BalanceQueryService.getExpectedCash()`, accepts Actual Cash, computes Difference, writes the `CashHandover` document, then delegates to `LedgerWriteService.recordHandover()` and (if Difference ≠ 0) `recordCorrection()`.
**Allowed dependencies:** `BalanceQueryService`, `LedgerWriteService`, `CashHolderService`.
**Forbidden:** computing a balance itself, trusting a client-supplied "expected" value.

### `CashTransferService` / `CashAdvanceService`
Same shape as `CashHandoverService` — thin orchestrators over their own document plus `LedgerWriteService`.

### `PaymentService` / `WarehouseSaleService` (renamed from `WalkInSalesService`) / `StockExitsService` / `SupplierPaymentsService`
**Unchanged responsibility:** own their respective business documents exactly as today.
**Changed behavior:** never touch `LedgerEntry`/`CashHolder` directly — they resolve a `CashHolder.id` (via `CashHolderService`) and call `LedgerWriteService.recordCollection()` inside their own transaction, exactly mirroring today's `creditAccount` call shape but through the new, hardened service.

**No overlap:** every service above has exactly one write authority (its own table) and at most one dependency chain downward (business service → `LedgerWriteService`/`CashHolderService`/`CurrencyConversionService` → nothing further). No circular dependencies exist anywhere in this graph.

---

## 4. Final Money Flow

For every flow: Trigger / Transaction boundary / Business document / Ledger entries / Balance changes / Validation / Permissions.

**Client Payment**
Trigger: payment recorded against a client/invoice. Boundary: one transaction. Document: `Payment`. Entries: one `recordCollection` (`CUSTODY`) if method is holding and a holder is resolved; none if a direct method. Balance: holder's custody balance +amount. Validation: client exists, amount > 0, invoice (if any) is in a payable status, holder is active. Permissions: `owner`, `accountant`, `sales_rep`.

**Warehouse Sale (registered client)**
Trigger: sale entered against a known client. Boundary: one transaction. Document: `Invoice` + `StockExit`(s) + `Payment` (if collected). Entries: one `recordCollection` referencing the `Payment`. Balance: holder's custody balance +amount collected. Validation: stock availability, exchange rate resolvable if conversion needed, holder active. Permissions: `owner`, `sales_rep`.

**Anonymous Sale**
Trigger: walk-in sale, no registered client. Boundary: one transaction. Document: `StockExit`. Entries: one `recordCollection` referencing the `StockExit`, whenever a holder and an amount are both present — **no exception this time**, unlike today's system where this path silently drops the ledger effect. Balance: holder's custody balance +amount. Validation: same as above. Permissions: `owner`, `sales_rep`, `worker` (worker restricted to non-sale exit types, unchanged from today).

**Supplier Payment**
Trigger: business pays a supplier. Boundary: one transaction. Document: `SupplierPayment`. Entries: one `recordCollection`-shaped **debit** (a new `LedgerWriteService.recordOutboundPayment()` operation — a debit against the paying holder) *only* when paid via a holding method drawn from a holder's float; none for direct methods (bank transfer). Balance: holder's custody balance −amount. Validation: holder has sufficient balance (soft rule, overridable by `owner`). Permissions: `owner`, `accountant`.

**Refund**
Trigger: money returned to a client. Boundary: one transaction. Document: existing `Payment` (referenced, not modified) + new debit entry, or an `Invoice`-layer credit with no ledger entry. Entries: one `recordCorrection`-family entry (`type = refund`) for cash refunds; none for credit-note refunds. Balance: holder's custody balance −amount (cash refund only). Validation: original payment exists and was collected by a holder (for cash refunds). Permissions: `owner`, `accountant`.

**Advance**
Trigger: business gives a holder cash to spend. Boundary: one transaction. Document: `CashAdvance`. Entries: one `recordAdvance` (`category = ADVANCE`). Balance: holder's *advance* balance +amount (never mixed with custody balance). Validation: holder active. Permissions: `owner`, `accountant`.

**Opening Float**
Trigger: holder assigned a starting float. Boundary: one transaction. Document: `OpeningFloat`. Entries: one `recordOpeningFloat` (`category = CUSTODY`, `type = opening_float`). Balance: custody balance +float amount, but excluded from Expected Cash at handover (§2). Validation: holder active, no currently-active float already assigned (supersede instead). Permissions: `owner`.

**Cash Count**
Trigger: a spot-check. Boundary: none required (read + one non-ledger insert). Document: `CashCount`. Entries: **none**. Balance: unaffected. Validation: holder exists. Permissions: `owner`, `accountant`.

**Cash Handover**
Trigger: holder deposits cash to custody. Boundary: one transaction. Document: `CashHandover`. Entries: one `recordHandover` (debit, = Actual) + one correction entry if Difference ≠ 0. Balance: custody balance decreases by Actual, then by the correction if any (net result: balance reflects the true post-handover state, which is not always zero if Actual < Expected and no correction were posted — but a correction is *always* posted when they differ, so the balance always lands at exactly zero for the custody dimension, with the shortage/overage separately and permanently recorded). Validation: Actual ≥ 0; a zero-Actual handover against a positive balance requires a mandatory reason. Permissions: `owner`, `accountant`.

**Cash Transfer**
Trigger: holder-to-holder movement. Boundary: one transaction. Document: `CashTransfer`. Entries: linked debit (`fromHolder`) + credit (`toHolder`). Balance: `fromHolder` −amount, `toHolder` +amount, net zero across the business. Validation: both holders exist and are active, same currency, sufficient balance on `fromHolder` (soft rule, `owner` override). Permissions: `owner`, `accountant`.

**Bank Deposit**
Trigger: cash moved from a person/drawer holder into a bank-account holder. Boundary/Document/Entries/Balance: identical to Cash Transfer — no new mechanism. Validation/Permissions: same as Cash Transfer.

**ATM Withdrawal**
Trigger: cash moved from a bank-account holder into a person/drawer holder. Boundary/Document/Entries/Balance: identical to Cash Transfer, direction reversed. Validation/Permissions: same as Cash Transfer.

**Correction**
Trigger: any need to fix a past ledger effect. Boundary: one transaction. Document: none of its own — references the entry/document being corrected. Entries: one specialized correction-type entry (§1). Balance: adjusted by the correction amount. Validation: mandatory reason; must reference a real prior entry. Permissions: `owner` only.

---

## 5. Final Ledger Design

**Lifecycle:** created once, by `LedgerWriteService`, inside the same transaction as its source document. Never updated. Never deleted, by any code path, at any privilege level.

**Entry types:** `collection`, `handover`, `transfer_out`, `transfer_in`, `opening_float`, `advance_given`, `refund`, `handover_shortage`, `handover_overage`, `collection_correction`, `transfer_correction`, `manual_intervention`.

**Category:** `CUSTODY` (cash collected on the business's behalf, expected back) or `ADVANCE` (cash given out, reconciled against expenses). Balances are always computed per-holder, per-currency, **per-category** — never mixed.

**Currencies:** every entry stores its native currency (no forced conversion at write time) plus an `exchangeRateHistoryId` reference stamped at creation.

**References:** exactly one of the nullable per-source-type foreign keys populated per row (§1); enforced by a database check constraint.

**Idempotency:** enforced one layer up, at the business-document level (§1) — `LedgerWriteService` itself assumes single-invocation-per-event.

**Corrections:** always new, specialized-type entries referencing what they correct; never a mutation.

**Immutability:** enforced at the API/service layer now; recommended to be reinforced later with database-level insert-only permissions on the ledger table as the system matures.

**Audit history:** the ledger *is* the audit history — every fact about cash custody is reconstructable from this table alone, plus its referenced source documents.

**Reconciliation:** a scheduled and on-demand job recomputes `LedgerCheckpoint` rows (below) from raw `LedgerEntry` data and flags any drift against the previous checkpoint — this should never find drift, given the invariants, but exists as a standing integrity safeguard, not an optional nicety.

**Versioning:** individual entries are never versioned (they never change). Any read-model projection instead carries a "last applied entry" watermark so staleness is detectable.

**Checkpoints:** `LedgerCheckpoint` — an immutable, periodically-generated record (`holderId`, `currency`, `category`, `asOfDate`, `balance`, `generatedAt`) that lets `BalanceQueryService` sum only the entries *after* the most recent checkpoint instead of scanning full history — a performance optimization of the same computation, never an independent source of truth, and never hand-editable.

---

## 6. Final CashHolder Design

**Should `CashHolder` exist?** Yes — resolved in §1, final.

**How does it relate to `User`?** Optional 1:1 — populated only when `type = person`. A `CashHolder` is never required to have a `User` behind it.

**Can it represent people, drawers, safes, vehicles, branches, bank accounts, cash registers, future holders?** Yes, all of them, via the `type` enum, extensible by adding new enum values — no schema change needed to add a new *kind* of holder, only a schema change to add a new *field* if a kind ever needs kind-specific data (e.g., a bank account's account number), which would live in a small kind-specific side table, not on `CashHolder` itself.

**Lifecycle:** Created → Active → deactivation blocked while any nonzero balance exists in any currency/category → Deactivated (all history retained, excluded from new selection) → hard delete permitted only when zero `LedgerEntry` rows reference it.

---

## 7. Final Read Architecture (CQRS Strategy)

**Write model:** `LedgerEntry`, normalized, transactional, owned exclusively by `LedgerWriteService`.

**Read model:** `BalanceQueryService` and `CashReportingService`, computing from `LedgerEntry` (+ `LedgerCheckpoint` for efficiency at scale). **Starts as a live query** — no materialized view is required on day one.

**CQRS boundary:** the boundary is the service split itself (§3), not any particular storage technology. This is deliberate: the boundary can be introduced without waiting for a performance problem, and the storage behind it (live query today, materialized view or separate read-replica-backed store later) can change without any caller noticing.

**Caching:** permitted only *inside* `BalanceQueryService`'s own implementation (e.g., a short-TTL in-process cache for a hot "all balances" read) — never as a column on a business table, never writable by any other service.

**Materialized views:** not required initially. If introduced later, they are refreshed exclusively by `BalanceQueryService`'s own scheduled job — the same rule as checkpoints (§5).

**Reconciliation jobs:** scheduled (e.g., nightly) and on-demand (owner-triggered), recomputing checkpoints and flagging drift. Required the moment any cached/materialized read path exists; harmless overhead if none does yet.

**Dashboards / Reports / Activity Feed:** consume `CashReportingService` for cash-custody figures only (total collected, total handed over, current balances). Revenue, AR, and cost figures continue to come from `ReportsService`/`ClientBalanceService` as today — this is not a regression, it's the correct separation (§1, §10).

---

## 8. Final Currency Architecture

**`ExchangeRateHistory`:** append-only; every rate change is a new row (`rate`, `currencyPair`, `sourceType`, `effectiveFrom`, `setByUserId`); never updated.

**`CurrencyConversionService`:** the sole writer of the above and the sole performer of any currency-conversion arithmetic anywhere in the system.

**Rate snapshots:** every `LedgerEntry` stores a reference (`exchangeRateHistoryId`), not a bare number — the entry's own currency plus the referenced historical rate together give a fully reconstructable historical USD-equivalent value at any future point, regardless of what the live rate becomes.

**Historical reporting:** uses each entry's own referenced rate (matching how `Invoice.exchangeRateSnapshot` already works elsewhere in this codebase).

**Live reporting:** uses `CurrencyConversionService.getCurrentRate(sourceType)` explicitly, for "right now" views (e.g., "all balances converted to USD today").

**Multiple rate sources:** supported from day one via `sourceType` — default source is `official`; a `parallel` (or any future) source can be added without a schema change, since it's a value in an existing column, not a new structural concept.

**Future currencies:** the per-currency ledger already generalizes to any number of currencies without a schema change — `currency` is a value, not a structural assumption.

**Cross-currency reporting:** any aggregate spanning multiple currencies (e.g., "total cash held, in USD, across all holders") is computed explicitly by `CashReportingService` calling `CurrencyConversionService` per currency bucket — never by summing raw amounts across currencies, anywhere, under any circumstance.

---

## 9. Final Security Model

| Action | Allowed roles | Notes |
|---|---|---|
| Collect cash (any collection flow) | `owner`, `accountant`, `sales_rep`, `worker`* | *worker restricted to non-sale exit types, unchanged from today |
| Transfer cash between holders (incl. bank deposit / ATM withdrawal) | `owner`, `accountant` | narrower than "collect" — moves custody without an external sale |
| Confirm a handover | `owner`, `accountant` | unchanged from today |
| Record a cash count | `owner`, `accountant` | read-only in effect; no ledger write |
| Issue an advance | `owner`, `accountant` | |
| Assign an opening float | `owner` | |
| Reverse / correct a ledger entry | `owner` only | mandatory reason always required |
| Archive / deactivate a holder | `owner` only | |
| Reopen a handover | **nobody, ever** | always reverse-and-supersede instead |
| Edit historical ledger data | **nobody, ever**, at any privilege level | enforced at API layer now; DB-level insert-only permission recommended as a later hardening step |
| View all holders' balances | `owner`, `accountant` | |
| View a branch's holders' balances | `owner`, `accountant`, plus a branch-scoped manager role (future, once `CashHolder.branchId` is in use) | |
| View one's own balance | any authenticated cash-capable role | reasonable transparency addition, not present today |

**Approval workflows:** a single `owner` approval suffices for reversals at current business scale. An optional `requireDualApprovalAboveAmount` configuration is architected into `LedgerWriteService.recordCorrection()` from the start (a second approving `owner` required above a configurable threshold) but **defaults to disabled** — this is a resolved decision (the mechanism exists, the default is off) rather than an open question, and can be turned on by configuration alone whenever the business decides a threshold is warranted.

**Manual SQL recovery strategy:** resolved in §1 — any direct database intervention on the ledger must be paired with a `manual_intervention` correction entry and a mandatory reason. This is a process rule for whoever performs the intervention, not a technical control this architecture can fully enforce by itself — it is stated here as a hard operational requirement.

**Branch isolation:** achieved via `CashHolder.branchId` (nullable today, populated once multi-branch is real) plus a scoping check in `BalanceQueryService`/`CashReportingService` that restricts non-`owner` results to the caller's assigned branch(es).

**Audit logging:** the ledger itself is the audit log for every cash movement. Non-money administrative actions on `CashHolder` (create/deactivate/reactivate) should additionally be recorded in a general-purpose audit log, consistent with how the rest of the application would log any sensitive admin action — this is not a new concept specific to cash management.

---

## 10. Final Validation Rules

1. Every cash-affecting business event that involves a holder produces exactly one `LedgerEntry` (or exactly one linked debit/credit pair, for transfers), written in the same transaction as the business event.
2. A `LedgerEntry` is created once and never updated or deleted, by any code path, for any reason.
3. A holder's balance, per currency and per category, always equals the signed sum of that holder's `LedgerEntry` rows in that currency/category.
4. No nonzero balance may exist without at least one `LedgerEntry` explaining it.
5. Every write-inducing business operation carries a client-generated idempotency key, enforced by a unique constraint on the resulting business document.
6. A holder referenced by any ledger-affecting operation must exist and be active — enforced inside `LedgerWriteService`/`CashHolderService`, never merely assumed from frontend input.
7. Expected Cash for a handover is always computed server-side, at confirmation time, from the ledger — never accepted as client input.
8. Every correction entry references the entry or document it corrects and carries a mandatory reason.
9. Every `LedgerEntry` references exactly one real, foreign-key-enforced source document — never a bare, unenforced string.
10. Handovers are never reopened; corrections are always new entries, and a fresh `CashHandover` record is created if a full re-do is needed.
11. Deactivating or archiving a holder never deletes or hides their ledger history; hard deletion is permitted only when zero entries reference that holder.
12. A cash transfer cannot leave the source holder negative by default; an explicit `owner` override is required to permit it.
13. A handover's Actual Cash amount cannot be negative.
14. A zero-Actual handover against a positive balance is allowed but requires a mandatory reason.
15. Currency amounts are never summed across different currencies at any layer, for any report, under any circumstance — every cross-currency aggregate goes through `CurrencyConversionService` explicitly.
16. `CUSTODY` and `ADVANCE` balances for the same holder are never summed together into one figure.
17. Every rate change is a new `ExchangeRateHistory` row; rates are never edited in place.
18. History must always be fully reproducible: given only `LedgerEntry` + `ExchangeRateHistory` + the referenced source documents, every holder's balance at any point in time must be reconstructable with no dependency on any cache having been correct.

---

## 11. Final Scalability Strategy

**50 branches:** `CashHolder.branchId` + branch-scoped queries in `BalanceQueryService`/`CashReportingService` (§9). `getAllBalances()` is always filtered/paginated by branch, role, or search — never an unfiltered fetch-everyone query.

**Thousands of users:** unaffected structurally — the number of `User`s is orthogonal to the number of `CashHolder`s (most users never hold cash); permission checks remain O(1) role/branch lookups.

**Millions of ledger entries:** `LedgerCheckpoint` (§5) bounds how far back a live balance query must scan; indexing on `(holderId, currency, category, occurredAt)` is required from the first production deployment, not added reactively; table partitioning by date range is the next step once checkpointed queries alone stop being sufficient, and remains compatible with full history retention (partitions are never dropped, only aged into cheaper storage if ever necessary).

**Offline devices / mobile applications:** the `occurredAt`/`recordedAt` split (§1) plus idempotency keys generated client-side, before connectivity is guaranteed, together make delayed-sync collection safe — a mobile app collects an event offline, assigns its idempotency key and true `occurredAt` immediately, and syncs whenever connectivity returns; the server-side write is identical to an online write.

**Multiple APIs:** every write path — whichever frontend or integration triggers it — ultimately calls the same `LedgerWriteService`/`CashHolderService`/`CurrencyConversionService` trio, so consistency does not depend on how many API surfaces exist.

**Multiple currencies:** already fully general (§8) — no structural change needed for a new currency.

**Payment gateways / bank integrations:** modeled as new source-document types feeding `LedgerWriteService.recordCollection()`, requiring one new nullable FK column on `LedgerEntry` per new integration — an accepted, infrequent cost (§1), not a redesign.

**Verdict:** the architecture holds at the stated scale without structural revision. The only actions required as scale increases are: populate `branchId`, add checkpoints/partitioning, and add one FK column per new integration — all additive, none disruptive.

---

## 12. Final Migration Plan

No phase requires a big-bang deployment. Every phase ships independently and is individually rollback-safe.

### Phase 0 — Centralize, change nothing behaviorally
**Objective:** introduce `LedgerWriteService`/`BalanceQueryService`/`CurrencyConversionService` as thin wrappers around today's existing `creditAccount`/`debitAccount` functions and `SettingsService.getExchangeRate()`, with **zero schema change**.
**DB changes:** none. **Backend changes:** move `PaymentService`, `StockExitsService`, `WalkInSalesService` to call the new services instead of importing the loose functions; behavior is bit-for-bit identical. **Frontend changes:** none. **Testing:** regression tests confirming identical balances before/after for a fixed set of scenarios. **Rollback:** trivial — revert the wrapper, no data was touched. **Risk:** low.

### Phase 1 — Close the receiver-resolution gap (highest value, independent of everything else)
**Objective:** fix the by-name-vs-by-id defect (Audit §1.3–1.5) using today's identity model (holder = `User.id`, `CashHolder` not yet introduced).
**DB changes:** none. **Backend changes:** add server-side holder validation before any ledger write (the enforcement §3 describes, temporarily keyed on `User.id`). **Frontend changes:** `ClientDetail.tsx`, `FillClientDetail.tsx`, and the anonymous-warehouse-sale picker now resolve and send a real `User.id` instead of a name string, matching the one path that already worked correctly. **Testing:** verify all four receiver-selection flows now credit the ledger identically. **Rollback:** feature-flaggable per page. **Risk:** medium (touches three frontend pages), but no schema risk.

### Phase 2 — Introduce `CashHolder`
**Objective:** add the dedicated entity without disrupting existing data.
**DB changes:** new `CashHolder` table; one-time backfill creating one `CashHolder` row per existing cash-capable `User` (additive, non-destructive); add nullable `holderId` columns alongside existing `receiverId`/`collectedById` on `Payment`/`StockExit` for a transition period.
**Backend changes:** dual-write both the legacy field and `holderId` during the transition; reads prefer `holderId`, fall back to legacy fields.
**Frontend changes:** pickers now select a `CashHolder`, not a `User`, directly.
**Testing:** verify every existing `receiverId`/`collectedById` value has a matching `CashHolder` row post-backfill.
**Rollback:** stop dual-writing, keep reading legacy fields — no data loss since legacy columns are untouched during the transition.
**Risk:** medium.

### Phase 3 — Harden the ledger (currency, references, `ExchangeRateHistory`)
**Objective:** evolve today's `AccountEntry` into the final `LedgerEntry` shape.
**DB changes:** add `currency` (backfill existing rows as `USD`, matching the precedent already used elsewhere in this codebase for bag purchases/fuel/etc.); add the nullable per-source-type FK columns alongside the existing `referenceId` (dual-write, validate they match, then drop `referenceId`); new `ExchangeRateHistory` table, backfilled with one row from today's current `Setting.exchangeRate` value.
**Backend changes:** `CurrencyConversionService` becomes the sole writer of rate changes going forward, replacing the in-place `Setting` overwrite.
**Testing:** shadow-write period comparing old vs. new reference columns before cutover; reconciliation script confirming total balances match exactly pre/post migration.
**Rollback:** the shadow-write period means the old columns remain authoritative until explicitly cut over — safe to abort at any point before cutover.
**Risk:** medium-high (touches the money-critical table) — mitigated by the shadow-write approach.

### Phase 4 — Idempotency keys
**Objective:** add the missing duplicate-submission protection.
**DB changes:** nullable, uniquely-constrained `idempotencyKey` columns on `Payment`, `StockExit`, `CashHandover`.
**Backend/Frontend changes:** frontend generates one UUID per user action; backend enforces uniqueness and returns the original result on a repeat.
**Testing:** double-submit tests confirming exactly one document/ledger effect results.
**Rollback:** column is nullable and additive — safe to add without immediately enforcing uniqueness, then tighten once verified.
**Risk:** low-medium.

### Phase 5 — Redesign Cash Handover
**Objective:** server-computed Expected Cash; expenses become real ledger transactions instead of a discarded frontend calculation.
**Backend changes:** `CashHandoverService` rewritten per §3/§6/§4; `expectedAmt` is no longer accepted from the client.
**Frontend changes:** the handover screen's ad hoc expense list is replaced by real "record an expense against my float" actions (reusing/extending existing `GeneralExpense`/`WorkerCost` flows) performed as expenses actually happen; the handover screen becomes purely "count what's here, compare to what the ledger says."
**Testing:** end-to-end tests confirming Expected Cash matches the ledger exactly; user-facing change requires a short internal training note since the workflow moves from "type expenses in at handover time" to "record expenses when they happen."
**Rollback:** the old handover screen can remain available behind a flag during transition.
**Risk:** medium — the only phase with a genuine user-facing workflow change.

### Phase 6 — New flows: `CashTransfer`, `OpeningFloat`, `CashCount`, `CashAdvance`
**Objective:** ship the previously-missing flows.
**DB changes:** four new tables, purely additive.
**Backend/Frontend changes:** new orchestrator services and UI, independent of everything else — can ship in any order, whenever the business needs each one.
**Testing:** standard flow tests per §13.
**Rollback:** trivial — unused tables/features if never adopted.
**Risk:** low.

### Phase 7 — Scale hardening
**Objective:** `LedgerCheckpoint`, partitioning, branch scoping.
**Trigger:** undertaken only once real branch count or data volume approaches the scale that needs it — not before.
**Risk:** low, purely additive, no urgency at current scale.

---

## 13. Final Testing Strategy

**Unit tests:** `LedgerWriteService` entry creation and validation rules (holder must exist/be active, exactly-one-reference constraint, category never mixed); `CurrencyConversionService` rate resolution at arbitrary timestamps.

**Integration tests:** full flow tests (Payment → Ledger → Handover; Sale → Ledger → Transfer → Handover) confirming the business document and its ledger effect are always consistent.

**Concurrency tests:** parallel collections against the same holder confirm the final balance is correct with no lost updates (relying on Postgres row-level atomicity, as the original audit already verified holds for the current `increment`/`decrement` pattern).

**Transaction tests:** simulate a failure between the business-document write and the ledger write, confirming a full rollback with no orphaned document or orphaned entry.

**Idempotency tests:** submit the same operation twice with the same key; confirm exactly one document and exactly one ledger effect result.

**Currency tests:** confirm USD and LBP entries are never summed together; confirm historical reports use each entry's stamped rate while live reports use the current rate; confirm a rate change never alters a previously-computed historical figure.

**Permission tests:** every row of the §9 table gets a positive test (allowed role succeeds) and a negative test (disallowed role is rejected).

**Migration verification:** a scripted before/after reconciliation confirming every holder's total balance is bit-for-bit identical across each migration phase's cutover point.

**Reconciliation verification:** confirm the checkpoint/recalculate job produces results identical to a full from-scratch ledger scan, on a dataset large enough to make the difference meaningful.

**Performance tests:** balance-query latency at a simulated 1,000,000-row ledger, with and without a checkpoint, to validate the §11 scalability claims before they're needed in production.

**Disaster recovery tests:** restore from a backup containing only `LedgerEntry` + `ExchangeRateHistory` + referenced source documents, and confirm every balance is exactly reconstructable — validating the "backup/restore is a strength of this design" claim from the prior review.

---

## 14. Final Development Rules

- **Never write directly to `LedgerEntry`.** Every write goes through `LedgerWriteService`.
- **Never calculate a balance outside `BalanceQueryService`.** Every report, every page, every dashboard figure about cash custody calls it — never its own `SUM`.
- **Never update or delete a historical ledger row.** Not through an ORM call, not through a migration, not through a one-off script without a paired `manual_intervention` correction entry.
- **Always use an idempotency key** on every write-inducing user action.
- **Always reference a `CashHolder.id`**, never a name string, never a `User.id` directly once Phase 2 has landed.
- **Always resolve currency conversion through `CurrencyConversionService`.** Never write a new `CASE WHEN currency = 'LBP'` block anywhere else in the codebase.
- **Never mix `CUSTODY` and `ADVANCE` balances** in a single figure.
- **Never treat `Expected Cash` as anything other than a server computation.** If a client sends one, ignore it.
- **Never reopen a handover.** Reverse and supersede.
- **Never add a new collection source without a real, dedicated nullable foreign key** on `LedgerEntry` — no generic string references, ever, for any reason, even "just this once."
- **Never let a report answer a revenue/AR/cost question using the cash ledger.** Those questions have their own, already-correct services.
- **Every new `PaymentMethod` must declare, explicitly, whether it is a holding method (needs a `CashHolder`) or a direct method (doesn't)** before it can be used anywhere.

---

## 15. Deliverable Checklist

This document contains, as required: Executive Summary (§0), Final Domain Model (§2), Final Service Architecture (§3), Final Data Flow / Money Flow (§4), Final Security Model (§9), Final Currency Strategy (§8), Final CQRS Strategy (§7), Final Validation Rules (§10), Final Scalability Strategy (§11), Final Migration Plan (§12), Final Testing Strategy (§13), Final Development Rules (§14) — plus the Resolved Conflicts table (§1), Ledger Design (§5), and CashHolder Design (§6) requested as their own sections.

No open questions remain. Where the prior three documents disagreed, §1 records the final decision and the reasoning. Implementation may begin from this document alone, without consulting `RECEIVER_BALANCE_CASH_HANDOVER_AUDIT.md`, `CASH_MANAGEMENT_ARCHITECTURE_SPEC.md`, or `CASH_MANAGEMENT_SPEC_REVIEW.md` — those remain on disk only as historical record of how this design was reached.

---

*This is the final, authoritative architecture document for the Cash Management System. No source files were modified to produce it.*
