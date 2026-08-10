# Cash Management System — Implementation Roadmap

Executes `CASH_MANAGEMENT_FINAL_BLUEPRINT.md`, which is frozen and treated as the architecture contract. No redesign occurs here — every PR below implements a decision the blueprint already made. Where a genuine sequencing dependency exists that the blueprint didn't spell out (e.g., `OpeningFloat` shipping after the code that will eventually use it), it's called out explicitly as a note, not a redesign.

No code is written in this document. This is the execution plan only.

**Format per PR:** Goal · Files · DB migration · Backend services touched · Frontend touched · Tests to add · Manual QA checklist · Rollback · Complexity · Breaking-change risk · Dependencies.

---

## PHASE 0 — Centralize, change nothing behaviorally

Goal of the phase: introduce the service boundaries the blueprint requires, as thin wrappers around the code that already exists. Zero schema change. Zero user-visible change. Pure risk reduction before anything else moves.

### PR 1 — Extract `LedgerWriteService` + `BalanceQueryService` (wrapping today's functions)
- **Goal:** Move `creditAccount`/`debitAccount` out of `cash-handovers.service.ts` into a new `ledger` module, unchanged in behavior. Move the read logic of `getAllBalances`/`getReceiverBalance` into `BalanceQueryService`.
- **Files:** new `apps/backend/src/ledger/ledger-write.service.ts`, `apps/backend/src/ledger/balance-query.service.ts`, `apps/backend/src/ledger/ledger.module.ts`. `apps/backend/src/cash-handovers/cash-handovers.service.ts` (remove the two functions, delegate instead).
- **DB migration:** none.
- **Backend services touched:** `CashHandoversService` (now depends on `LedgerModule`).
- **Frontend touched:** none.
- **Tests:** unit tests for `LedgerWriteService.creditAccount/debitAccount` (moved, not new) confirming identical output to the pre-PR functions on the same inputs; regression test on `CashHandoversService.create` confirming balance math unchanged.
- **Manual QA:** run one full handover through the UI, confirm balance before/after matches pre-deploy behavior exactly.
- **Rollback:** revert the commit; no data touched.
- **Complexity:** S. **Breaking-change risk:** none (internal refactor only).
- **Dependencies:** none — first PR.

### PR 2 — Migrate `PaymentsService` to `LedgerWriteService`
- **Goal:** `payments.service.ts` calls `LedgerWriteService.recordCollection` instead of importing `creditAccount` directly.
- **Files:** `apps/backend/src/payments/payments.service.ts`, `apps/backend/src/payments/payments.module.ts` (import `LedgerModule`).
- **DB migration:** none.
- **Backend services:** `PaymentsService`.
- **Frontend:** none.
- **Tests:** existing `payments.service.spec.ts`-style test confirming a payment with `receiverId` still credits the ledger identically.
- **Manual QA:** record a payment with a receiver on Client Detail, confirm the receiver's balance increases as before.
- **Rollback:** revert commit.
- **Complexity:** S. **Risk:** none.
- **Dependencies:** PR 1.

### PR 3 — Migrate `StockExitsService` to `LedgerWriteService`
- **Files:** `apps/backend/src/stock-exits/stock-exits.service.ts`, `stock-exits.module.ts`.
- Same shape as PR 2. **Complexity:** S. **Risk:** none. **Dependencies:** PR 1.

### PR 4 — Migrate `WalkInSalesService` (Warehouse Sale) to `LedgerWriteService`
- **Files:** `apps/backend/src/walk-in-sales/walk-in-sales.service.ts`, `walk-in-sales.module.ts`.
- Same shape as PR 2. **Complexity:** S. **Risk:** none. **Dependencies:** PR 1.

### PR 5 — Retire the loose functions; finalize read-side centralization
- **Goal:** `getAllBalances`/`getReceiverBalance` in `cash-handovers.service.ts` now call `BalanceQueryService` exclusively; the original `creditAccount`/`debitAccount` exports are deleted from `cash-handovers.service.ts` (fully replaced by PR 1's move).
- **Files:** `apps/backend/src/cash-handovers/cash-handovers.service.ts`.
- **Tests:** confirm no remaining import of the old function names anywhere (`grep` check in CI or a lint rule).
- **Manual QA:** Cash Handover page loads balances identically to before.
- **Rollback:** revert commit.
- **Complexity:** S. **Risk:** none. **Dependencies:** PR 2, 3, 4 (all callers migrated first).

*End of Phase 0. System behaves identically to today; three services now share one real dependency instead of one loosely imported.*

---

## PHASE 1 — Close the receiver-resolution gap (on today's identity model)

Goal: fix the single highest-value defect from the audit — three of four receiver pickers silently not crediting the ledger — using `User.id` as the holder reference (before `CashHolder` exists). This phase is independently valuable and ships before any schema work.

### PR 6 — Server-side holder validation inside `LedgerWriteService`
- **Goal:** `recordCollection` rejects a collection whose holder doesn't exist or isn't eligible, instead of silently no-op'ing when the field is absent (today's actual defect) or trusting an unchecked ID.
- **Files:** `apps/backend/src/ledger/ledger-write.service.ts`, new `apps/backend/src/users/users.service.ts` method `validateCashCapable(userId)` (temporary home, pending `CashHolderService` in Phase 2).
- **DB migration:** none.
- **Tests:** unit test — collection with a nonexistent/deleted user id throws `NotFoundException`; collection with a valid id succeeds.
- **Manual QA:** attempt a payment with a tampered `receiverId` (e.g. via API client) — expect a clean 404, not a silent no-op.
- **Rollback:** revert commit.
- **Complexity:** S. **Risk:** low (adds a check, doesn't relax anything).
- **Dependencies:** PR 1–5.
- **Post-merge finding (architecture audit, 2026-08-01):** PR 6's own manual QA step does not actually pass end-to-end for any of the three current `creditAccount` callers — see PR 6b below, which was opened specifically to close this gap. PR 6 itself was not reverted or changed; it remains correct and independently valuable (see PR 6b's rationale).

### PR 6b — Move holder validation before the write in each `creditAccount` caller
- **Goal:** in all three current `creditAccount` callers (`PaymentsService`, `StockExitsService`, `WalkInSalesService`), the unvalidated receiver/collector id is written into a foreign-key-constrained column (`Payment.receiverId`, `StockExit.collectedById`) *before* `LedgerWriteService.creditAccount()` is ever invoked — confirmed by direct code inspection: `payments.service.ts:169` (`tx.payment.create`), `stock-exits.service.ts:262/269/297` (`tx.stockExit.create`), and `walk-in-sales.service.ts:217` (`tx.payment.create`) all run *before* their respective `creditAccount` call, and each of those columns has a real Postgres FK (`schema.prisma:717-718`, `647-648`). A nonexistent id therefore fails today as a raw `PrismaClientKnownRequestError` surfaced to the client as a generic 500 (`{"error":"Internal server error"}`), never reaching PR 6's validation at all. `CashHandoversService` already does this correctly — it runs `this.prisma.user.findUnique(...)` and throws a clean `NotFoundException` *before* opening its transaction (`cash-handovers.service.ts:59-64`) — this PR replicates that same validate-then-write ordering in the three callers that don't yet have it.
- **Files:** `apps/backend/src/payments/payments.service.ts`, `apps/backend/src/stock-exits/stock-exits.service.ts`, `apps/backend/src/walk-in-sales/walk-in-sales.service.ts` — each calls `usersService.validateCashCapable(receiverId` / `collectedById)` immediately after resolving the field from the DTO, before the corresponding document-create call.
- **DB migration:** none.
- **Relationship to PR 6:** `LedgerWriteService.creditAccount()`'s own `validateCashCapable` call is left exactly as PR 6 built it — not redundant, not removed. It becomes defense-in-depth once this PR lands, and remains the *only* check that can catch a soft-deleted (as opposed to nonexistent) holder: a Postgres FK constraint verifies row existence only, not the application-level `deletedAt` flag, so a soft-deleted user's id still satisfies the FK and reaches `creditAccount`, where PR 6's check is what actually rejects it. This PR closes the nonexistent-id gap; PR 6 continues to close the soft-deleted-id gap. Both are needed.
- **Tests:** for each of the three services — a nonexistent `receiverId`/`collectedById` now throws `NotFoundException` *before* the document-create mock is ever called (regression vs. today, where the mock *is* called and only the real DB layer would reject it).
- **Manual QA:** repeat PR 6's original manual QA step (payment/stock-exit/walk-in-sale with a tampered `receiverId`/`collectedById` via API client) and confirm a clean rejection this time, not a generic 500 with a leaked Prisma stack trace.
- **Rollback:** revert commit — `LedgerWriteService`'s own validation (untouched) continues to provide the same partial protection PR 6 already shipped.
- **Complexity:** S — the same small addition, three times. **Risk:** low (adds a check strictly earlier than an existing DB constraint; makes an existing failure cleaner, doesn't relax anything).
- **Dependencies:** PR 6. Independent of PR 7–9 — those change what the *frontend sends*; this PR changes what happens when a bad value *is* sent, from any source (a not-yet-fixed page, a direct API client, or a race between page-load and submit). Can be implemented in parallel with PR 7–9 by a different engineer with no file overlap.

### PR 7 — Fix `ClientDetail.tsx` "Record Payment" receiver resolution
- **Goal:** resolve the picked name back to a real `User.id` and send `receiverId`, mirroring the pattern `WarehouseSales.tsx` already uses correctly.
- **Files:** `src/pages/ClientDetail.tsx` (the `allReceivers`/`payReceiverName` state and the `useCreatePayment` call site).
- **DB migration:** none.
- **Frontend:** `ClientDetail.tsx` only.
- **Tests:** component/integration test — selecting a receiver and submitting sends `receiverId`, not just `receiverName`; a follow-up API test confirms the receiver's balance increases.
- **Manual QA:** record a payment on Client Detail with a receiver selected; confirm that receiver's balance now increases on the Cash Handover page (previously it silently did not).
- **Rollback:** revert commit — no data migration involved, purely additive to the request payload.
- **Complexity:** S. **Risk:** low (additive field; existing `receiverName`-only submissions still work identically for anyone not yet using the fix).
- **Dependencies:** PR 6.

### PR 8 — Fix `FillClientDetail.tsx` "Record Payment" receiver resolution
- Same shape as PR 7. **Files:** `src/pages/FillClientDetail.tsx`. **Complexity:** S. **Risk:** low. **Dependencies:** PR 6.

### PR 9 — Fix `WarehouseSales.tsx` anonymous-sale "Received by" resolution
- **Goal:** resolve `collectedById` (not just `collectedBy` name) for both the packed and by-kg anonymous branches.
- **Files:** `src/pages/WarehouseSales.tsx` (the two `createExit.mutateAsync` call sites currently sending only `collectedBy`).
- **Tests:** integration test — an anonymous sale with a receiver picked and an amount entered now credits that receiver's ledger balance (previously dead code, per the audit).
- **Manual QA:** record an anonymous walk-in sale with an amount and a receiver; confirm the receiver's balance increases.
- **Rollback:** revert commit.
- **Complexity:** S. **Risk:** low.
- **Dependencies:** PR 6.

*End of Phase 1. All four receiver-selection UIs now credit the ledger correctly, using today's `User.id`-based identity model, and (with PR 6b) an invalid holder id fails cleanly instead of leaking a raw database error. This alone closes the audit's highest-priority finding and can ship to production before any further work begins.*

---

## PHASE 2 — Introduce `CashHolder`

### PR 10 — `CashHolder` table (additive, no other table touched)
- **Prisma schema change:** new `model CashHolder { id, type, userId?, label, branchId?, active, createdAt, updatedAt }`, `@@map("cash_holders")`.
- **DB migration:** `npx prisma migrate dev --name add_cash_holder` — pure `CREATE TABLE`, no existing table altered.
- **Files:** `apps/backend/prisma/schema.prisma`, generated migration folder.
- **Backend:** none yet (table exists, unused).
- **Tests:** migration-applies-cleanly test in CI; a smoke test creating one `CashHolder` row of each `type`.
- **Manual QA:** none user-facing yet.
- **Rollback:** drop the table (no other table references it yet, so this is trivially safe to revert).
- **Complexity:** S. **Risk:** none (additive, unused).
- **Dependencies:** Phase 1 complete.

### PR 11 — `CashHolderService` + backfill script
- **Goal:** CRUD + `validateActiveHolder()`; one-time script creating one `CashHolder(type=person)` row per existing `User` who has ever been a `receiverId`/`collectedById` on any `Payment`/`StockExit`, or holds `Role.receiver`.
- **Files:** new `apps/backend/src/cash-holders/{cash-holders.service.ts, cash-holders.controller.ts, cash-holders.module.ts, dto/create-cash-holder.dto.ts}`; one-off script under `apps/backend/prisma/scripts/backfill-cash-holders.ts`.
- **DB migration:** none (data-only backfill, not a schema change).
- **Tests:** unit tests for CRUD + `validateActiveHolder`; a backfill-script test asserting one `CashHolder` per qualifying `User`, no duplicates on re-run (idempotent script).
- **Manual QA:** run backfill against a copy of the dev DB, spot-check row counts match expectations.
- **Rollback:** the backfill only inserts rows in a new, unreferenced table — safe to truncate and rerun.
- **Complexity:** M. **Risk:** low.
- **Dependencies:** PR 10.

### PR 12 — Wire `LedgerWriteService` validation to `CashHolderService`
- **Goal:** replace PR 6's temporary `UsersService.validateCashCapable` with `CashHolderService.validateActiveHolder` — everywhere it's called from, not just inside `LedgerWriteService`.
- **Files:** `apps/backend/src/ledger/ledger-write.service.ts`, `ledger.module.ts` (import `CashHoldersModule`), plus the three call sites PR 6b added (`payments.service.ts`, `stock-exits.service.ts`, `walk-in-sales.service.ts`) — each swaps its `usersService.validateCashCapable(...)` call for `cashHolderService.validateActiveHolder(...)`.
- **Tests:** update PR 6's and PR 6b's unit tests to validate against `CashHolder` rows instead of `User` rows.
- **Manual QA:** none new — same behavior, different backing table.
- **Rollback:** revert commit.
- **Complexity:** S. **Risk:** low.
- **Dependencies:** PR 11.

### PR 13 — Add nullable `holderId` to `Payment` (dual-write)
- **Prisma schema change:** `Payment.holderId String? → CashHolder`.
- **DB migration:** `add_holder_id_to_payments` — additive nullable column + FK, no data loss possible.
- **Files:** `schema.prisma`, migration, `apps/backend/src/payments/payments.service.ts` (populate both `receiverId` and `holderId` on create, resolving the `CashHolder` from the given `User.id`).
- **Tests:** create-payment test asserting both fields populated and pointing at consistent identities.
- **Manual QA:** record a payment with a receiver; confirm `holderId` is set in the DB alongside the existing `receiverId`.
- **Rollback:** stop dual-writing; drop the column if truly unused (safe, nothing reads it yet).
- **Complexity:** S. **Risk:** low.
- **Dependencies:** PR 11.

### PR 14 — Add nullable `holderId` to `StockExit` (dual-write)
- Same shape as PR 13, for `StockExitsService`/`WalkInSalesService`. **Files:** `schema.prisma`, migration, `stock-exits.service.ts`, `walk-in-sales.service.ts`. **Complexity:** S. **Risk:** low. **Dependencies:** PR 11.

### PR 15 — Add nullable `holderId` to `CashHandover` (dual-write)
- Same shape, for `CashHoversService.create`. **Files:** `schema.prisma`, migration, `cash-handovers.service.ts`. **Complexity:** S. **Risk:** low. **Dependencies:** PR 11.

### PR 16 — Switch reads to prefer `holderId`, verify against legacy fields
- **Goal:** `BalanceQueryService`/`getReceiverBalance` reads `holderId` first, falls back to legacy `receiverId`/`collectedById` only for historical rows created before PR 13–15.
- **Files:** `apps/backend/src/ledger/balance-query.service.ts`, `cash-handovers.service.ts`.
- **Tests:** reconciliation test — for every row with both fields populated, they resolve to the same underlying person; a report confirming zero mismatches across the full table.
- **Manual QA:** run the reconciliation query against staging data, confirm zero mismatches before proceeding.
- **Rollback:** revert to reading only legacy fields.
- **Complexity:** M. **Risk:** medium (first read-path change touching real balances — mitigate by running the reconciliation report as a required gate before merge).
- **Dependencies:** PR 13, 14, 15.

### PR 17 — Frontend: `useCashHolders` hook + swap every picker
- **Goal:** new hook wrapping `GET /cash-holders`; `WarehouseSales.tsx`, `ClientDetail.tsx`, `FillClientDetail.tsx`, `CashHandover.tsx`, `Settings.tsx` all select a `CashHolder` id instead of a `User`/name.
- **Files:** new `src/hooks/useCashHolders.ts`; edits to the five pages listed.
- **Tests:** component tests per page confirming the submitted id is a `CashHolder.id`.
- **Manual QA:** full manual pass through all five pages' receiver pickers.
- **Rollback:** revert to `useReceivers`/`useUsers`-based pickers (kept in place until this PR merges — not deleted early).
- **Complexity:** M. **Risk:** low (additive; old hooks remain available for rollback).
- **Dependencies:** PR 16.

*Cleanup PR (deferred, non-blocking): drop legacy `receiverId`/`receiverName`/`collectedBy`/`collectedById` columns and `useReceivers.ts` once PR 17 has been live and verified for a full billing cycle. Tracked as PR C1 at the end of this document — not on the critical path.*

---

## PHASE 3 — Harden the ledger (rename, currency, typed references, exchange-rate history)

This is the highest-risk phase — it touches the money-critical table directly. Every PR here is deliberately small and additive; nothing destructive happens until a dedicated, later cleanup PR, run only after a verification gate.

### PR 18 — Rename `AccountEntry` → `LedgerEntry` (pure rename, no behavior change)
- **Prisma schema change:** rename model + `@@map`; Prisma migration uses `ALTER TABLE ... RENAME TO`, preserving all data and constraints.
- **Files:** `schema.prisma`, migration, every call site referencing `prisma.accountEntry` (now `prisma.ledgerEntry`) — confined to `apps/backend/src/ledger/*`.
- **Tests:** full regression suite for `LedgerWriteService`/`BalanceQueryService`.
- **Manual QA:** confirm the app boots and one full payment→balance→handover cycle works post-rename.
- **Rollback:** reverse rename migration (data preserved either direction).
- **Complexity:** S. **Risk:** low (rename only, single migration, well-isolated call sites from Phase 0's centralization).
- **Dependencies:** Phase 0 complete (all reads/writes already centralized, so only one module needs updating).

### PR 19 — Add `currency` to `LedgerEntry`, backfill `USD`
- **DB migration:** additive `currency Currency @default(USD)` column; backfill existing rows to `USD` (matching the precedent already used elsewhere in this codebase, per the audit, for bag purchases/fuel/other retrofits).
- **Files:** `schema.prisma`, migration, `ledger-write.service.ts` (`recordCollection`/`recordHandover` accept and persist a `currency` parameter, defaulting `USD` until callers are updated in PR 20–22).
- **Tests:** backfill assertion — every pre-existing row is `USD`; new-entry test with an explicit `LBP` currency.
- **Manual QA:** none new.
- **Rollback:** drop column (safe, nothing depends on it outside the ledger module yet).
- **Complexity:** S. **Risk:** low.
- **Dependencies:** PR 18.

### PR 20 — Pass real currency from `PaymentsService`
- **Files:** `payments.service.ts` — pass `dto.currency` into `recordCollection` instead of relying on the default.
- **Tests:** an LBP payment now stores an LBP ledger entry, not a mis-tagged USD one.
- **Manual QA:** record an LBP payment, confirm the ledger entry's currency in the DB.
- **Rollback:** revert commit (falls back to default-USD behavior, not a data loss).
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 19.

### PR 21 — Pass real currency from `StockExitsService` / `WalkInSalesService`
- Same shape as PR 20. **Files:** `stock-exits.service.ts`, `walk-in-sales.service.ts`. **Complexity:** S. **Risk:** low. **Dependencies:** PR 19.

### PR 22 — Pass real currency from `CashHandoversService`
- **Goal:** handover debit uses the currency of the balance actually being cleared (today's handover form has no currency selector at all — this PR adds one).
- **Files:** `cash-handovers.service.ts`, `src/pages/CashHandover.tsx` (add a currency selector when a holder holds more than one currency).
- **Tests:** handover against an LBP balance debits the LBP ledger only, leaving any USD balance untouched.
- **Manual QA:** a holder with both USD and LBP balances can hand over each independently.
- **Complexity:** M. **Risk:** medium (first user-facing UI change in this phase). **Dependencies:** PR 19.

### PR 23 — Add nullable per-source-type FKs to `LedgerEntry` (dual-populate alongside `referenceId`)
- **Prisma schema change:** `paymentId String? → Payment`, `stockExitId String? → StockExit`, `cashHandoverId String? → CashHandover` (all nullable).
- **DB migration:** additive columns only.
- **Files:** `schema.prisma`, migration, `ledger-write.service.ts` (populate the correct typed FK alongside the existing `referenceId` string on every write).
- **Tests:** every existing ledger-writing test asserts both the legacy `referenceId` and the new typed FK are set and consistent.
- **Manual QA:** spot-check new rows in the DB have exactly one typed FK populated, matching the `referenceId`.
- **Rollback:** stop dual-populating; drop columns (nothing reads them yet).
- **Complexity:** M. **Risk:** low (additive, unread).
- **Dependencies:** PR 18.

### PR 24 — Add the "exactly one reference" check constraint
- **DB migration:** `ALTER TABLE ledger_entries ADD CONSTRAINT exactly_one_reference CHECK (...)`.
- **Pre-condition:** run a verification query confirming zero existing rows would violate the constraint (required manual gate before this PR merges).
- **Files:** migration only.
- **Tests:** an attempted insert with zero or two typed FKs populated is rejected at the DB level (integration test against a real Postgres instance).
- **Rollback:** drop the constraint.
- **Complexity:** S. **Risk:** medium (a bad backfill would surface here as a hard failure — treated as a feature, not a risk, since it's exactly the integrity check we want, but still requires the pre-merge verification gate).
- **Dependencies:** PR 23, verified across the full table.

### PR 25 — Switch reads to the typed FKs; stop relying on `referenceId`
- **Files:** `balance-query.service.ts`, `cash-handovers.service.ts` (`getReceiverBalance`'s payments/exits detail query).
- **Tests:** confirm identical output to the `referenceId`-based query on the same dataset.
- **Manual QA:** Cash Handover receiver-detail table renders identically.
- **Rollback:** revert to `referenceId`-based reads.
- **Complexity:** M. **Risk:** medium.
- **Dependencies:** PR 24.

### PR 26 — `ExchangeRateHistory` table + backfill
- **Prisma schema change:** new `model ExchangeRateHistory { id, currencyPair, rate, sourceType, effectiveFrom, setByUserId, createdAt }`.
- **DB migration:** `CREATE TABLE`; backfill one row from the current `Setting.exchangeRate` value, `sourceType='official'`, `effectiveFrom=now()`.
- **Files:** `schema.prisma`, migration, backfill script.
- **Tests:** backfill produces exactly one row matching today's live rate.
- **Manual QA:** none user-facing yet.
- **Rollback:** drop table (unreferenced so far).
- **Complexity:** S. **Risk:** none.
- **Dependencies:** none within this phase (can run in parallel with PR 18–25).

### PR 27 — `CurrencyConversionService`
- **Goal:** `getCurrentRate`, `getRateAt`, `convert`, `recordRateChange` — all reading/writing `ExchangeRateHistory` exclusively.
- **Files:** new `apps/backend/src/currency/{currency-conversion.service.ts, currency.module.ts}`.
- **Tests:** unit tests for rate resolution at arbitrary timestamps, including "no rate before this date" edge case.
- **Manual QA:** none yet (unused by callers until PR 28+).
- **Rollback:** revert commit; table remains, unused.
- **Complexity:** M. **Risk:** none. **Dependencies:** PR 26.

### PR 28 — `LedgerWriteService` stamps `exchangeRateHistoryId` on every entry
- **Prisma schema change:** `LedgerEntry.exchangeRateHistoryId String? → ExchangeRateHistory` (nullable initially, becomes required once all writers pass through this path — already true by this point since Phase 0 centralized every writer).
- **DB migration:** additive column.
- **Files:** `schema.prisma`, migration, `ledger-write.service.ts` (calls `CurrencyConversionService.getCurrentRate()` internally on every write).
- **Tests:** every new entry has a non-null rate reference; historical rows remain null (expected — backfilled separately if ever needed for reporting, not required for correctness going forward).
- **Manual QA:** record a payment, confirm the resulting ledger row references the current `ExchangeRateHistory` row.
- **Rollback:** revert; column stays nullable and unused.
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 27, PR 19.

### PR 29 — `SettingsService` rate updates write through `CurrencyConversionService`
- **Goal:** the existing "update exchange rate" admin action now calls `CurrencyConversionService.recordRateChange()`, which both inserts a new `ExchangeRateHistory` row and (during transition) keeps the legacy `Setting.exchangeRate` field updated for any code not yet migrated off it.
- **Files:** `apps/backend/src/settings/settings.service.ts`, `settings.controller.ts`.
- **Tests:** updating the rate produces a new history row and updates the legacy field identically to before.
- **Manual QA:** change the rate in Settings, confirm both the new history table and the old behavior reflect it.
- **Rollback:** revert commit; legacy field remains the sole source until re-merged.
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 27.

### PR 30 — Migrate `ReportsService` currency conversions to `CurrencyConversionService`
- **Goal:** replace every inline `CASE WHEN currency = 'LBP' THEN ... / rate` SQL block in `reports.service.ts` (P&L, AR summary, walk-in revenue, bag cost, fuel, other-expenses) with calls through the shared service, closing the audit's "Dashboard vs. Reports show different totals" finding once §10 reporting-layer work (Phase 3.5 below) is also in place.
- **Files:** `apps/backend/src/reports/reports.service.ts`.
- **Tests:** golden-value regression tests — every existing `reports.service.spec.ts` case must produce byte-identical output before/after (this PR must not change any number, only its implementation).
- **Manual QA:** compare Dashboard and Reports figures before/after on a fixed dataset.
- **Rollback:** revert commit.
- **Complexity:** L (touches the most SQL-dense file in the backend). **Risk:** medium (read-only, so no data-corruption risk, but a regression here is user-visible on the most-viewed pages).
- **Dependencies:** PR 27.

*End of Phase 3. The ledger now has currency, real references, and a real rate history. Phase 3 is the highest-risk phase in this roadmap and should not be parallelized with Phase 2/4 work by the same engineer — see Critical Path below.*

---

## PHASE 3.5 — Centralized cash reporting (closes the Dashboard/Reports inconsistency)

### PR 30a — `CashReportingService`
- **Goal:** `getTotalCollected(dateRange, conversionMode)`, `getTotalHandedOver(dateRange)`, `getAllHolderSummaries()` — composing `BalanceQueryService`, never duplicating its logic.
- **Files:** new `apps/backend/src/cash-reporting/{cash-reporting.service.ts, cash-reporting.module.ts}`.
- **Tests:** unit tests confirming totals match a manual sum over known fixture data, in both historical-rate and live-rate modes.
- **Manual QA:** none yet (unused until PR 30b).
- **Rollback:** revert commit.
- **Complexity:** M. **Risk:** none. **Dependencies:** PR 30.

### PR 30b — Point Dashboard and Reports at `CashReportingService` for cash-custody figures only
- **Goal:** `src/pages/Dashboard.tsx` and `src/pages/Reports.tsx` call the same endpoint for "total collected" instead of two different report aggregations; revenue/AR/cost figures are explicitly left untouched (they are correctly a different question, per the blueprint's §1/§10).
- **Files:** `Dashboard.tsx`, `Reports.tsx`, new hook `src/hooks/useCashReporting.ts`.
- **Tests:** both pages render the identical "total collected" number on the same date range.
- **Manual QA:** side-by-side comparison of both pages.
- **Rollback:** revert commit.
- **Complexity:** M. **Risk:** low (additive; old AR/P&L figures remain for everything except the one reconciled number).
- **Dependencies:** PR 30a.

---

## PHASE 4 — Idempotency

### PR 31 — Idempotency key columns
- **Prisma schema change:** nullable, uniquely-constrained `idempotencyKey String? @unique` on `Payment`, `StockExit`, `CashHandover`.
- **DB migration:** additive columns + unique indexes.
- **Files:** `schema.prisma`, migration.
- **Tests:** inserting two rows with the same key fails at the DB level.
- **Manual QA:** none yet.
- **Rollback:** drop columns/indexes.
- **Complexity:** S. **Risk:** low (nullable, non-enforcing until PR 32 wires the check).
- **Dependencies:** none (can run any time after Phase 0).

### PR 32 — Backend dedup logic
- **Files:** `payments.service.ts`, `stock-exits.service.ts`, `walk-in-sales.service.ts`, `cash-handovers.service.ts` — each `create()` accepts an optional `idempotencyKey`; if a row with that key already exists, return it instead of creating a duplicate.
- **DTO changes:** add optional `idempotencyKey` (`@IsOptional() @IsUUID()`) to `CreatePaymentDto`, `CreateStockExitDto`, `CreateWalkInSaleDto`, and the new `CreateCashHandoverDto` (see PR 36).
- **Tests:** submitting the identical request twice with the same key returns the same document both times; no duplicate ledger entry results.
- **Manual QA:** rapid double-click on each "submit" button in a test environment, confirm only one record is created.
- **Rollback:** revert commit; column remains unused, no risk.
- **Complexity:** M. **Risk:** low.
- **Dependencies:** PR 31.

### PR 33 — Frontend idempotency key generation
- **Files:** `WarehouseSales.tsx`, `ClientDetail.tsx`, `FillClientDetail.tsx`, `CashHandover.tsx` — generate one UUID per user action (on button press, not on every render), send it with the request, disable the submit control while the mutation is pending.
- **Tests:** component test confirming the same key is reused across a retried request within one user action.
- **Manual QA:** simulate a network drop mid-submit (dev tools throttling), confirm the retried request doesn't double-create.
- **Rollback:** revert commit — backend still functions without a key (it's optional).
- **Complexity:** S per page (4 small changes). **Risk:** low.
- **Dependencies:** PR 32.

---

## PHASE 5 — Redesign Cash Handover

### PR 34 — Extend `LedgerEntry.type` with correction types
- **Prisma schema change:** extend the entry-type enum (or string+check) with `handover_shortage`, `handover_overage`, `collection_correction`, `transfer_correction`, `manual_intervention`.
- **DB migration:** enum extension (additive, backward compatible).
- **Files:** `schema.prisma`, migration, `ledger-write.service.ts` (`recordCorrection(holderId, amount, currency, type, referenceId, reason)`).
- **Tests:** a correction entry requires a non-empty `reason` (rejected otherwise); a correction of the wrong type for its context is rejected (e.g., a `handover_shortage` must reference a `CashHandover`).
- **Manual QA:** none yet (unused until PR 35).
- **Rollback:** revert; unused enum values are harmless.
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 18 (rename complete).

### PR 35 — `BalanceQueryService.getExpectedCash()`
- **Goal:** compute custody balance for a holder+currency directly from `LedgerEntry`. **Note:** at this point in the sequence `OpeningFloat` doesn't exist yet (Phase 6), so this first version has no float to net out — a safe degenerate case (float = 0 for everyone) that PR 43 later extends, not replaces.
- **Files:** `balance-query.service.ts`.
- **Tests:** matches a manual sum over fixture data.
- **Manual QA:** none yet.
- **Rollback:** revert commit.
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 19 (currency on the ledger).

### PR 36 — Real `CreateCashHandoverDto`
- **Goal:** replace the inline, unvalidated body type on `POST /cash-handovers` (the audit's "no input validation" finding) with a proper `class-validator`-decorated DTO. `expectedAmt` is **removed** from the DTO entirely — it is never accepted from the client from this point forward.
- **Files:** new `apps/backend/src/cash-handovers/dto/create-cash-handover.dto.ts`; `cash-handovers.controller.ts`.
- **Tests:** malformed requests (bad UUID, non-numeric amount) now return a clean 422 instead of propagating a `NaN` into a `Decimal` column.
- **Manual QA:** submit a malformed request via API client, confirm a clean validation error.
- **Rollback:** revert to the inline type (temporarily reintroducing the audit's original gap — acceptable only as an emergency rollback, not a target state).
- **Complexity:** S. **Risk:** low. **Dependencies:** none beyond Phase 0.

### PR 37 — Server-computed Expected Cash in `CashHandoversService.create`
- **Goal:** `create()` calls `getExpectedCash()` itself; computes `difference = actual − expected`; if nonzero, requires `notes` and posts a `handover_shortage`/`handover_overage` correction via `recordCorrection`.
- **Files:** `cash-handovers.service.ts`.
- **Tests:** a handover with `actual < expected` and no notes is rejected; with notes, it succeeds and produces exactly two ledger entries (debit + correction); a handover with `actual == expected` produces exactly one entry.
- **Manual QA:** run a handover with a deliberate shortage, confirm both entries appear in the receiver's ledger history with the correct types.
- **Rollback:** revert to accepting a client-supplied `expectedAmt` (temporary regression, same caveat as PR 36).
- **Complexity:** M. **Risk:** medium (changes real financial behavior on every handover going forward). **Dependencies:** PR 34, PR 35, PR 36.

### PR 38 — Frontend: stop sending `expectedAmt`; display server-computed value
- **Files:** `src/pages/CashHandover.tsx`, `src/hooks/useCashHandover.ts` (`useCreateCashHandover` payload drops `expectedAmt`; the existing `useReceiverBalance`/expected display already reads from a GET query and needs only minor adjustment to reflect the float-aware calculation once PR 43 lands).
- **Tests:** confirm the confirm-handover request body no longer includes `expectedAmt`.
- **Manual QA:** full handover flow end to end, confirm displayed expected/difference match what the server actually recorded.
- **Rollback:** revert commit (backend still accepts the old shape gracefully if a stray client sends it — the field is simply ignored per PR 36, not rejected, avoiding a hard break during rollout).
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 37.

### PR 39 — Remove the unpersisted expense-subtraction UI (interim step)
- **Goal:** remove `CashHandover.tsx`'s ad hoc `expenses` React-state list and its subtraction from "expected" (which is now server-computed and doesn't know about it) — replace with a short note pointing users at the existing General Expenses page in the interim, pending PR 51's real integration.
- **Files:** `src/pages/CashHandover.tsx`.
- **Tests:** none beyond existing component tests updated for the removed UI.
- **Manual QA:** confirm the handover screen no longer implies expenses are being deducted when they aren't yet wired to the ledger.
- **Rollback:** revert commit (reintroduces the discarded-data UX gap temporarily).
- **Complexity:** S. **Risk:** low (UX-only change). **Dependencies:** PR 38.

*End of Phase 5. Handovers are now server-authoritative. This is the last phase before net-new features begin.*

---

## PHASE 6 — New flows: Transfer, Opening Float, Cash Count, Advance

### PR 40 — `CashTransfer` table
- **Prisma schema change:** `model CashTransfer { id, fromHolderId, toHolderId, amount, currency, reason, date, initiatedById }`.
- **DB migration:** `CREATE TABLE` only.
- **Complexity:** S. **Risk:** none. **Dependencies:** PR 10.

### PR 41 — `LedgerWriteService.recordTransfer()` + `CashTransferService`/controller/DTO
- **Files:** new `apps/backend/src/cash-transfers/*`; `ledger-write.service.ts` (linked debit+credit pair, shared transaction).
- **Tests:** a transfer produces exactly two entries, correctly signed, same currency, same transaction (rollback test: force a failure after the debit, confirm no credit is left orphaned).
- **Manual QA:** transfer cash between two holders via API client, confirm both balances update atomically.
- **Complexity:** M. **Risk:** low (net-new, no existing behavior touched). **Dependencies:** PR 40, Phase 4 (idempotency key on this new document too).

### PR 42 — Frontend: Cash Transfer UI
- **Files:** new `src/pages/CashTransfer.tsx` or a modal within `CashHandover.tsx`; `src/hooks/useCashTransfers.ts`; add a nav entry gated `owner`/`accountant`.
- **Tests:** component test for the from/to/amount/currency/reason form.
- **Manual QA:** full transfer flow via the UI.
- **Complexity:** M. **Risk:** low. **Dependencies:** PR 41.

### PR 43 — `OpeningFloat` table + service + `getExpectedCash` float-netting
- **Prisma schema change:** `model OpeningFloat { id, holderId, amount, currency, assignedById, activeFrom, supersededAt? }`.
- **DB migration:** `CREATE TABLE`.
- **Files:** new `apps/backend/src/opening-floats/*`; `balance-query.service.ts` (`getExpectedCash` now subtracts any currently-active float for that holder+currency — closing the dependency noted in PR 35).
- **Tests:** a holder with a $50 float and $200 collected shows Expected Cash = $150, not $200 (this is the first real behavioral use of the float concept — precise coverage required).
- **Manual QA:** assign a float, collect cash, confirm the handover screen's expected figure nets it out correctly.
- **Complexity:** M. **Risk:** medium (changes the Expected Cash calculation for anyone with a float assigned — must be verified against zero-float holders producing identical results to before, as a regression gate). **Dependencies:** PR 35.

### PR 44 — Frontend: assign/supersede opening float (owner-only)
- **Files:** likely inside `src/pages/Settings.tsx` or a new small modal on `CashHandover.tsx`'s holder detail view.
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 43.

### PR 45 — `CashCount` table + service/controller/DTO (no ledger entries)
- **Prisma schema change:** `model CashCount { id, holderId, expectedAmt, countedAmt, currency, notes, date, countedById }`.
- **DB migration:** `CREATE TABLE`.
- **Files:** new `apps/backend/src/cash-counts/*`.
- **Tests:** creating a `CashCount` never produces a `LedgerEntry` — explicit negative test.
- **Manual QA:** run a spot-check count, confirm the holder's balance is completely unaffected.
- **Complexity:** S. **Risk:** none (no ledger interaction by design). **Dependencies:** PR 35 (reuses `getExpectedCash`).

### PR 46 — Frontend: spot-check count action
- **Files:** a button on the receiver-balance detail view in `CashHandover.tsx`.
- **Complexity:** S. **Risk:** none. **Dependencies:** PR 45.

### PR 47 — `CashAdvance` table + `recordAdvance` + service/controller/DTO
- **Prisma schema change:** `model CashAdvance { id, holderId, amount, currency, reason, date, issuedById }`; `LedgerEntry.category` enum (`CUSTODY | ADVANCE`), additive column defaulting `CUSTODY` for all existing rows.
- **DB migration:** two additive changes — new table, new column with a safe default.
- **Files:** new `apps/backend/src/cash-advances/*`; `ledger-write.service.ts` (`recordAdvance`); `balance-query.service.ts` (balances always computed per-category, never summed across).
- **Tests:** an advance never contributes to `getExpectedCash` (custody-only); a holder's advance balance and custody balance are independently queryable and never combined in one figure — explicit test asserting this.
- **Manual QA:** issue an advance, confirm it appears as a separate figure from the holder's collected-cash balance.
- **Complexity:** M. **Risk:** low (additive category, defaults preserve all existing behavior). **Dependencies:** PR 35.

### PR 48 — Frontend: issue advance + display advance balance
- **Files:** likely on the receiver-balance detail view alongside the existing custody balance, clearly labeled as a separate figure.
- **Complexity:** S. **Risk:** low. **Dependencies:** PR 47.

### PR 49 — Real expense-ledger integration (closes PR 39's interim gap)
- **Goal:** `GeneralExpense`/`WorkerCost` recording optionally references a `CashHolder` and posts a debit `LedgerEntry` (`category=CUSTODY`, referencing the expense record) at the time the expense is recorded — so by handover time, `getExpectedCash()` already nets out legitimately-recorded expenses with no special-casing.
- **Prisma schema change:** nullable `holderId`/`ledgerEntryId` linkage on `GeneralExpense`/`WorkerCost` (additive).
- **Files:** `apps/backend/src/general-expenses/general-expenses.service.ts`, `apps/backend/src/workers/workers.service.ts` (wherever `WorkerCost` is created), plus a new nullable per-type FK on `LedgerEntry` (`generalExpenseId`, `workerCostId`) per the "typed reference" rule established in Phase 3.
- **Tests:** recording an expense against a holder debits their custody balance; recording one without a holder behaves exactly as today (no ledger effect) — non-breaking for existing expense-recording flows that don't specify a holder.
- **Manual QA:** record an expense against a holder's float mid-day, confirm the handover screen's expected figure already reflects it without any manual entry at handover time.
- **Complexity:** L (touches two existing, unrelated modules). **Risk:** medium (changes real balances for anyone who opts into holder-linked expenses; fully backward-compatible for anyone who doesn't). **Dependencies:** PR 34 (typed references), PR 37 (handover uses `getExpectedCash`).

*End of Phase 6. All money flows named in the blueprint now exist. Bank deposits and ATM withdrawals require no additional PR — they are `CashTransfer` rows where one side's `CashHolder.type = bank_account`, already fully supported by PR 40–42.*

---

## PHASE 7 — Scale hardening (deferred; not urgent at current scale)

### PR 50 — `LedgerCheckpoint` table
- **Prisma schema change:** `model LedgerCheckpoint { id, holderId, currency, category, asOfDate, balance, generatedAt }`.
- **Complexity:** S. **Risk:** none. **Dependencies:** none (can ship any time after PR 47).

### PR 51 — Reconciliation job + owner-only manual recalculate endpoint
- **Files:** new scheduled job (reuses existing job-scheduling convention if one exists in this codebase, otherwise a simple cron-triggered endpoint); `apps/backend/src/ledger/ledger-reconciliation.service.ts`.
- **Tests:** reconciliation output matches a full from-scratch ledger scan on a large fixture dataset.
- **Complexity:** M. **Risk:** low (read-only verification tool). **Dependencies:** PR 50.

### PR 52 — `BalanceQueryService` uses checkpoints to bound scan range
- **Files:** `balance-query.service.ts`.
- **Tests:** performance test at a simulated large row count, with and without a checkpoint present, confirming identical results and materially lower latency.
- **Complexity:** M. **Risk:** low. **Dependencies:** PR 51.

### PR 53 — `CashHolder.branchId` + branch-scoped queries
- **Trigger:** only undertaken once multi-branch is a real, funded initiative — not before.
- **Complexity:** M. **Risk:** low (additive, nullable). **Dependencies:** PR 11.

---

## Cleanup PRs (non-blocking, run once each phase's verification window has passed)

- **PR C1:** drop legacy `receiverId`/`receiverName` (`Payment`), `collectedBy`/`collectedById` (`StockExit`), `receiverId`/`receiverName` (`CashHandover`) columns and the old `useReceivers.ts` hook. Gate: PR 17 live for one full billing cycle with zero reconciliation mismatches.
- **PR C2:** drop `LedgerEntry.referenceId` (the old generic string reference). Gate: PR 25 live and verified.
- **PR C3:** drop/repurpose `UserAccount.balance` (superseded by computed balances + checkpoints). Gate: PR 35 + PR 52 live and verified; consider retaining the table renamed as the checkpoint store rather than deleting it outright, to avoid an unnecessary extra migration.

---

## Dependency Graph (phase level)

```
Phase 0 (centralize)
   │
   ▼
Phase 1 (fix receiver resolution) ──────────► can ship to prod independently, immediately after Phase 0
   │claude --dangerously-skip-permissions
   ▼
Phase 2 (CashHolder) ──────► PR 17 (frontend swap) requires PR 16 (verified dual-read)
   │
   ▼
Phase 3 (ledger hardening: rename → currency → typed refs → constraint → rate history)
   │         │
   │         └── PR 30 (reports migration) can run in parallel with PR 23–25, both depend only on PR 19/27
   ▼
Phase 3.5 (cash reporting) ──── depends on Phase 3 fully landed
   │
   ▼
Phase 4 (idempotency) ──────── independent of Phase 2/3; could run in parallel with either, sequenced after Phase 0 only for clarity of ownership, not because of a real dependency
   │
   ▼
Phase 5 (handover redesign) ── depends on Phase 3 (currency, correction types) + Phase 4 (idempotency on the new DTO)
   │
   ▼
Phase 6 (new flows) ────────── depends on Phase 2 (CashHolder) + Phase 5 (getExpectedCash exists)
   │
   ▼
Phase 7 (scale hardening) ──── deferred, triggered by real growth, not calendar time
```

## Implementation Order (recommended)

1. Phase 0 (PR 1–5)
2. Phase 1 (PR 6, 6b–9) — **ship to production here if nothing else; this alone fixes the audit's top finding.**
3. Phase 2 (PR 10–17)
4. Phase 4 (PR 31–33) — pulled forward, since it has no real dependency on Phase 3 and de-risks every subsequent phase's rollout
5. Phase 3 (PR 18–30) + Phase 3.5 (PR 30a–30b)
6. Phase 5 (PR 34–39)
7. Phase 6 (PR 40–49)
8. Cleanup PRs (C1–C3), interleaved opportunistically once each gate passes
9. Phase 7 (PR 50–53), only once real scale demands it

## Critical Path

`PR 1 → 2/3/4 → 5 → 6 → 18 → 19 → 23 → 24 → 25 → 27 → 28 → 34 → 35 → 37 → 43`

This is the chain that every subsequent feature (Transfer, Advance, Cash Count) ultimately depends on through `getExpectedCash`/`recordCorrection`. Everything off this path (frontend picker swaps, reporting migration, scale hardening) can be resourced in parallel by a second engineer without blocking the chain above.

## Estimated Timeline

Assuming one backend-capable engineer on the critical path and one frontend-capable engineer on parallel UI work, in weekly increments:

- **Week 1:** Phase 0 (PR 1–5) + Phase 1 (PR 6, 6b–9). Ship Phase 1 to production at the end of this week.
- **Week 2:** Phase 2 backend (PR 10–15) + Phase 4 (PR 31–33) in parallel.
- **Week 3:** Phase 2 finish (PR 16–17) + start Phase 3 (PR 18–22).
- **Week 4:** Phase 3 continued (PR 23–28).
- **Week 5:** Phase 3 finish (PR 29–30) + Phase 3.5 (PR 30a–30b). Ship the reporting-consistency fix.
- **Week 6:** Phase 5 (PR 34–39). Ship the redesigned handover.
- **Week 7–8:** Phase 6 (PR 40–49), features can ship independently as each completes rather than waiting for all of them.
- **Ongoing/deferred:** Cleanup PRs and Phase 7, scheduled opportunistically.

Total: **~6 weeks to a fully consistent, currency-correct, idempotent ledger with a redesigned handover process; ~8 weeks including all net-new flows.** This assumes no scope surprises and reasonably fast review turnaround — it is a planning estimate, not a commitment.

## Highest-Risk Tasks

1. **PR 30 (reports migration)** — the largest, most SQL-dense single change; a regression here is visible on the most-viewed pages in the app. Mitigated by a golden-value regression suite that must produce byte-identical output.
2. **PR 37 (server-computed Expected Cash)** — changes real financial behavior on every future handover. Mitigated by extensive fixture-based testing before merge and a feature-flag-style rollback (PR 36/37 can revert to accepting client `expectedAmt` without any data loss).
3. **PR 24 (DB check constraint on ledger references)** — will hard-fail on any bad backfill data; this is by design, but requires the pre-merge verification query to actually be run, not skipped.
4. **PR 43 (opening-float netting in `getExpectedCash`)** — changes the expected-cash figure for any holder with a float; must be regression-tested to confirm zero-float holders see no change.
5. **PR 49 (expense-ledger integration)** — touches two existing, previously-unrelated modules (`GeneralExpense`, `WorkerCost`); the largest blast radius of any single PR in the roadmap, mitigated by making holder-linkage fully optional and backward-compatible.

## Safest Deployment Sequence

Deploy Phase 1 alone first and let it run in production for at least one full billing cycle before starting Phase 2 — it is the highest-value, lowest-risk change in the entire roadmap and validates the overall approach with real data before any schema work begins. Deploy every subsequent phase's *additive* migrations (new tables/nullable columns) well ahead of the *behavioral* PRs that start using them, so schema changes and logic changes are never bundled into the same deployment. Never deploy a destructive cleanup PR (C1–C3) in the same release as the phase it cleans up after — always leave at least one full verification window between "the new path is live" and "the old path is removed."

---

*This roadmap implements `CASH_MANAGEMENT_FINAL_BLUEPRINT.md` exactly as frozen. No architectural decision in the blueprint was revisited to produce it. No code was written.*
