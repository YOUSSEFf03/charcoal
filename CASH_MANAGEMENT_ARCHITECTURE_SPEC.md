# Cash Management System — Final Architecture Specification

Continuation of `RECEIVER_BALANCE_CASH_HANDOVER_AUDIT.md`. This document does not describe the current implementation — it defines what the implementation *should become*. No code was written or modified to produce it. Where the current system conflicts with the recommendation, that conflict is named explicitly, with the audit finding it traces back to.

This is the source of truth for implementation. Any future change to receiver selection, ledger writes, or cash handover must conform to this document or explicitly amend it first.

---

## 1. Business Concepts

Each concept is defined independently first, then related.

**Cash Collection**
The real-world event of the business receiving value from an external party — a client paying an invoice, a walk-in buying charcoal at the counter. A Cash Collection has an amount, a currency, a method (cash, whish, omt, bank_transfer, cheque), a date, and a source document (which business transaction produced it). It is the *cause*; everything below is downstream of it.

**Holding Method vs. Direct Method**
Not every collection method produces a physical cash-in-hand situation. `cash`, `whish`, and `omt` in this business are *holding methods* — money that physically or functionally sits with a person until it's deposited. `bank_transfer` and `cheque` are *direct methods* — the value goes straight to the company's bank account and is never "held" by an individual. This distinction determines whether a Cash Holder is even required.

**Cash Holder**
A person (or, in the future, a location — see §12) who is currently responsible for a sum of physical/functional cash on the business's behalf, pending handover. A Holder is not a separate identity from `User` — it is a *capability* a `User` can have. Only relevant when the collection method is a holding method.

**Cash Balance**
The amount a given Holder currently holds, **per currency**, at this instant. It is not an independent fact — it is derived, always and only, from the sum of that Holder's Ledger Entries in that currency.

**Ledger Entry**
The atomic, immutable record of one cash movement affecting one Holder (or, for a transfer, exactly two Holders via a linked pair). Positive = credit (cash came to this Holder). Negative = debit (cash left this Holder — via handover, transfer-out, refund, or correction). Every Ledger Entry carries: amount, currency, type, exchange-rate-at-time (see §8), a real foreign-key reference to the business document that caused it, a date, and who recorded it.

**Collection Event**
The umbrella term for anything that produces a *credit* Ledger Entry: a client Payment (holding method), a Warehouse Sale's collected cash, or any future collection channel (POS, mobile top-up, etc.). One Collection Event → one credit Ledger Entry (per Holder involved).

**Cash Handover**
The event where a Holder deposits everything they're holding into company custody (safe, bank, accountant). Produces one debit Ledger Entry (for the amount actually handed over) and, if there's a shortfall/overage, one additional correction Ledger Entry (§6). Conceptually the terminal state for a chain of Collection Events, though a Holder can accumulate again immediately afterward.

**Cash Transfer** *(future)*
Cash moving from Holder A to Holder B without leaving the business's custody boundary — e.g., a driver hands the day's cash to a warehouse supervisor instead of to the accountant directly. Produces a matched debit-A / credit-B Ledger Entry pair, same transaction, same currency, linked by a shared transfer reference.

**Payment**
A client-facing accounting document: "Client X paid $Y against Invoice Z on date D by method M." This lives at the accounts-receivable layer, independent of who physically held the cash. Every Payment *may* also be a Collection Event (if its method is a holding method and a Holder is attached) — but its existence is not conditional on that; a `bank_transfer` Payment is complete and correct with no Holder at all.

**Outstanding Cash**
Synonym for a Holder's current Cash Balance, used specifically in the context of "how much does this person still owe the business in physical cash" — i.e., the number Cash Handover exists to drive to zero.

**Expected Cash**
What the *system* calculates a Holder should currently be holding, computed server-side from their Ledger Entries at the moment a handover is being prepared. Never client-supplied.

**Actual Cash**
What a human physically counted and is handing over right now. This is the one number in the entire system that legitimately originates from user input at the moment of handover — everything else is derived or historical.

**Difference**
`Actual − Expected`. Never discarded. Always becomes its own Ledger Entry (a correction), so a shortage or overage is a permanent, attributable fact, not a silent adjustment.

### How they relate
```
Cash Collection (client payment or warehouse sale)
        │
        ├─ holding method? ──no──► no Holder involved, no Ledger Entry, Payment stands alone (AR only)
        │
       yes
        │
        ▼
   Holder assigned (must be a real, active, cash-capable User)
        │
        ▼
   Ledger Entry (credit) ── currency-tagged, rate-stamped, references the Payment/StockExit
        │
        ▼
   Holder's Cash Balance increases (derived, not stored-and-trusted)
        │
        │  (repeats all day, across every Collection Event that Holder is assigned to)
        │
        ▼
   Cash Handover prepared
        │
        ├─ Expected Cash = server-computed from Ledger Entries
        ├─ Actual Cash = human count, entered now
        ├─ Difference = Actual − Expected
        │
        ▼
   Ledger Entry (debit, = Actual)  +  Ledger Entry (correction, = Difference, if nonzero)
        │
        ▼
   Holder's Cash Balance returns to a known, ledger-consistent state (ideally zero, or explicitly whatever the correction left it at)
```

---

## 2. Single Source of Truth

**Store:** Ledger Entries. Nothing else is authoritative. Every fact about "who has how much cash" must be re-derivable from this table alone.

**Always calculate, never trust as input:** Cash Balance (per Holder, per currency), Expected Cash (at handover time). These are *outputs* of a query over Ledger Entries, never a value written by any code path outside the ledger-writing service, and never a value accepted from the frontend.

**Never duplicate:** the aggregation logic itself. One canonical set of query functions computes "balance for holder X in currency Y," "total collected in range," "total handed over in range." Every page/report that needs one of these numbers calls the same function — it does not re-derive it with its own SQL or its own in-memory reduce.

**Invariants (binding):**
1. Every cash-affecting business event that involves a Holder produces exactly one Ledger Entry, written inside the same database transaction as the business event itself.
2. A Ledger Entry, once committed, is never updated and never deleted. Corrections are new entries.
3. A Holder's Cash Balance, whether read live or served from a cache, must always equal the signed sum of that Holder's Ledger Entries in that currency. If a cache exists, exactly one code path is allowed to write it, and that code path is the same one that writes the Ledger Entry (same transaction).
4. No module other than the ledger-writing service ever writes to a balance-representing column. `PaymentService`, `WarehouseSalesService`, `StockExitsService`, and any future service that causes a cash movement call into the ledger service — they do not touch ledger/balance tables directly. *(This directly reverses the current pattern audited in §2/§7 of the previous document, where three separate services each import and call two loose helper functions.)*
5. A Holder's *identity* in a Ledger Entry is always a real foreign key to `User.id`. There is no code path where a name string is accepted as a substitute. *(This is the direct fix for Audit §1.3–1.5 — the by-name vs. by-ID gap that was the single highest-value finding.)*

---

## 3. Cash Flow Specification

### Client Payment → Ledger → Handover
```
Client Detail / Fill Client Detail / Invoices — "Record Payment"
  → resolve Holder (real User.id) IF method is a holding method
  → PaymentService.recordPayment(...)
      writes Payment (AR document, always)
      IF holder resolved: calls LedgerService.recordCollection(holder, amount, currency, ref=Payment)
  → Holder's balance increases (derived)
  → later: Cash Handover clears it
```
This is identical in shape to Warehouse Sale below — the point of centralizing on a `LedgerService` is that this flow and the next stop being two different implementations of the same idea.

### Warehouse Sale (registered client or anonymous) → Ledger → Handover
```
Warehouse Sales — "Enter sale"
  → resolve Holder (real User.id) if a collector/receiver is named, regardless of registered-client vs. anonymous
  → WarehouseSaleService.recordSale(...)
      writes Invoice + StockExit(s) (registered) OR StockExit only (anonymous)
      IF holder resolved AND amount collected > 0: calls LedgerService.recordCollection(holder, amount, currency, ref=StockExit/Payment)
  → same downstream as above
```
Note: today, the registered-client path and the anonymous path are two different code paths with two different (and inconsistently correct) receiver-resolution behaviors. Under this architecture they call the *same* ledger entry point — the only difference is which business document they reference.

### Cash Transfer *(future)*
```
Holder A hands cash to Holder B (no external sale, no handover to custody)
  → LedgerService.recordTransfer(fromHolder=A, toHolder=B, amount, currency, reason)
      writes Ledger Entry (debit A) + Ledger Entry (credit B), same transaction, linked by a transferGroupId
  → A's balance decreases, B's balance increases, total cash outstanding across all holders is unchanged
```

### Cash Handover
```
Cash Handover — "Confirm handover"
  → LedgerService.getExpectedCash(holder, currency)   [server-computed, not trusted from client]
  → user enters Actual Cash (counted)
  → CashHandoverService.confirm(holder, currency, actual, notes)
      writes CashHandover record (date, holder, expected [snapshot], actual, difference, notes)
      calls LedgerService.recordHandover(holder, actual, currency, ref=CashHandover)   → debit
      IF difference != 0: calls LedgerService.recordCorrection(holder, difference, currency, ref=CashHandover, reason=required)
  → Holder's balance settles to its new true state
```

### Refund *(future)*
Money already collected must be given back to a client. Two sub-cases:
- **Cash refund** (business physically returns cash from a Holder's float): `LedgerService.recordRefund(holder, -amount, currency, ref=Payment)` — a debit, same mechanics as a handover but the cash leaves toward the client instead of toward custody.
- **Accounting-only credit** (no cash physically moves, just an invoice/credit-note adjustment): does not touch the cash ledger at all — it's purely an AR-layer event on `Invoice`/`Client`, exactly as today's `ClientBalanceService` already handles credits/negative balances.

### Correction / Reversal *(needed immediately, not just future)*
A standalone Ledger Entry, `type = correction`, always requiring a `reason`, always `owner`-gated, always referencing the entry (or handover) it corrects. Never a mutation of the original row.

### Advance *(future)*
The business gives cash TO a Holder proactively (e.g., a driver's fuel advance) with no sale behind it. Modeled as a credit Ledger Entry of `type = advance_given`, later reconciled against actual expenses (which already exist as `GeneralExpense`/`WorkerCost` — the advance is simply the cash-side mirror of an expense that hasn't been itemized yet).

---

## 4. Receiver Architecture

**Can every User become a receiver?** Structurally, yes — "receiver" should not be a walled-off identity. Any `User`, regardless of `Role`, should be able to be a Cash Holder if the business needs them to be.

**Should receivers have a dedicated role?** The `Role.receiver` enum value should remain, but **only** for the narrow case of a person who exists in the system *solely* to hold cash and has no other function (a dedicated cashier with no login-worthy job otherwise). It should stop being treated as the *only* way to become a Holder.

**Recommendation:** decouple "what can this person do in the app" (`Role`) from "can this person hold cash" (a Holder capability). Concretely, this becomes an explicit attribute on the user (or a lightweight join), independent of role:
- `owner` — can hold cash. Permission-wise they can already do anything; no special-casing needed.
- `accountant` — can hold cash (e.g., they personally take a payment at the desk).
- `sales_rep` — can hold cash (this is the primary case today).
- `worker` — **should** be able to hold cash if they physically collect payment during a delivery/fill job — today `Worker` is a completely separate model from `User` with its own `totalEarned`/`totalPaid`, disconnected from `UserAccount`. This split needs to close: a worker who ever handles cash needs one unified ledger identity, not two unrelated balance systems living in parallel.
- `driver` — same reasoning as worker; drivers already collect payment on delivery routes in this business (see `ClientOrder.driverId`).
- Dedicated `receiver` role — cash-holding is their *entire* purpose, kept as-is.

**Should inactive users keep history?** Yes, unconditionally. Deactivating (not deleting) a Holder must never remove their `Ledger Entries`. The current hard-delete-with-cascade behavior (Audit §5/§13, finding 8) is the wrong lifecycle model entirely.

**Lifecycle:**
```
Created  →  Active (selectable as a Holder everywhere)
         →  Deactivation requested
                ├─ balance in every currency == 0 ? → deactivate immediately, history retained
                └─ balance != 0 ? → block deactivation, surface "outstanding balance" to the owner,
                                     require a handover (or explicit override with reason) first
         →  Deactivated (excluded from new selection, all history & ledger entries fully intact and queryable)
         →  (Hard delete: never allowed while any Ledger Entry references this user. If truly zero
             history and zero balance, deletion may be permitted, but this should be the rare case,
             not the default click-to-remove behavior it is today.)
```

---

## 5. Ledger Architecture

**Should `AccountEntry` remain?** Yes, as the renamed/hardened Ledger Entry table, with these changes from today's shape:
- Add a `currency` column (Audit §6/§13 finding 2 — the single most damaging structural gap: today USD and LBP amounts are summed as raw numbers).
- Replace the free-text `referenceId` with a proper typed reference (either a `referenceType` enum + `referenceId`, or dedicated nullable FK columns per possible source) so the database itself enforces that every entry traces to a real row.
- Add an `exchangeRateSnapshot` (mirroring the pattern `Invoice.exchangeRateSnapshot` already uses) so historical entries report correctly in USD-equivalent views regardless of how the live rate moves later.
- No update/delete capability exposed by any service — enforced at the API layer at minimum, ideally reinforced by DB permissions in a later hardening pass.

**Should `UserAccount` remain?** Reconceived, not necessarily removed. Two viable shapes:
- **(a) Per-holder-per-currency cache row** — e.g., separate `(holderId, currency) → balance` rows instead of one balance per user. Keeps today's fast-read property while fixing the currency-mixing bug.
- **(b) No stored balance at all** — compute `SUM(ledger_entries.amount) WHERE holderId = ? AND currency = ?` on every read, indexed on `(accountId/holderId, currency)`. At this business's scale (a handful of holders, a few hundred entries a month), this is very likely fast enough that the cache buys negligible benefit while removing an entire class of drift bugs.

**Recommendation:** start from (b) — compute, don't cache — and only reintroduce a cache if a real, measured performance need appears. If a cache is reintroduced later, it must be written *exclusively* inside the same service method that writes the Ledger Entry, in the same transaction, with no other writer permitted — and paired with an explicit, owner-only "recalculate balances from ledger" admin action that can detect and repair drift. That reconciliation tool does not exist today in any form and should exist regardless of whether a cache is used, as a standing integrity check.

---

## 6. Cash Handover Architecture

**What the frontend sends:** Holder id, currency, the counted Actual Cash amount, and free-text notes. Nothing else. No "expected" figure, no ad hoc expense list.

**What the backend calculates:** Expected Cash, computed fresh from Ledger Entries for that Holder+currency at the moment of handover. This is the core correction to Audit §4's central finding — today the backend trusts a client-computed `expectedAmt` outright; under this architecture it is impossible for the client to influence "expected" at all.

**What should be stored:** on the `CashHandover` record itself — the Holder, currency, the *snapshot* of Expected Cash the system computed at that moment, the Actual Cash entered, the Difference, notes, who confirmed it, and the date. Storing the Expected snapshot (rather than only computing it live and discarding it) means a later audit can compare "what the system believed then" against "what the ledger says now" and detect any drift introduced by a bug or a manual DB edit.

**What should never be trusted from the client:** Expected Cash, Difference, and — critically — the receiver's identity should never be accepted as a free-text name; it must be a real `User.id` resolved and validated server-side (exists, is active, is cash-capable) before any write occurs.

**How expenses should work:** Today, "expenses kept from collection" exist only as transient React state, subtracted from a client-computed "expected" figure, and vanish on submit (Audit §4, finding — expenses never persisted). Under this architecture, expenses deducted from a Holder's float during the day are **real transactions**, not a fudge factor typed into the handover form:
- An expense paid out of a Holder's cash-in-hand is recorded as its own Ledger Entry (`type = expense_deduction` or by reusing the existing `GeneralExpense`/`WorkerCost` recording flows, extended to optionally debit a Holder) at the time the expense actually happens — not retroactively invented at handover time.
- By the time a handover is prepared, Expected Cash (computed from the ledger) *already* nets out every legitimately-recorded expense. The handover screen no longer needs its own expense UI at all — it becomes purely "count what's physically here, compare to what the ledger says should be here."
- This is a structural fix, not a patch: it removes an entire category of data (unpersisted expense breakdowns) by making expenses a normal ledger fact instead of a handover-time side calculation.

**How differences should work:** `Difference = Actual − Expected`, always computed server-side, always surfaced to the user before confirmation, and — on confirmation — always posted as its own correction Ledger Entry (never silently folded into the handover debit). A nonzero difference should require a mandatory reason (the `notes` field, made required specifically in this case rather than optional as today).

**Should expected cash be stored or calculated later?** Both — calculated at the moment of handover (never stored ahead of time as a standing prediction), and then *stored as a snapshot* on the resulting `CashHandover` row once calculated, purely for audit/drift-detection purposes. It is never the input to anything; it is only ever an output that gets recorded.

---

## 7. API Architecture

**Central `LedgerService`** — the only module permitted to write Ledger Entries or touch any balance-representing data. Exposes a small, closed set of operations:
- `recordCollection(tx, holderId, amount, currency, referenceType, referenceId, description, date)`
- `recordHandover(tx, holderId, amount, currency, referenceId, date)`
- `recordTransfer(tx, fromHolderId, toHolderId, amount, currency, reason, date)` *(future)*
- `recordCorrection(tx, holderId, amount, currency, referenceId, reason, date)`
- `getBalance(holderId, currency)` / `getAllBalances()` / `getExpectedCash(holderId, currency)` — read-side.

This directly replaces today's two loosely-exported functions (`creditAccount`/`debitAccount`) living inside the Cash Handovers module and imported ad hoc by three unrelated services (Audit §2) — the functions were architecturally correct in *shape* (transaction-scoped, paired write), just wrongly *located* (a leaf feature module is not where a cross-cutting concern like "the ledger" should live) and incomplete (no currency awareness, no centralized receiver-resolution).

**Should every module call `LedgerService`?** Yes — `PaymentService`, `WarehouseSaleService`, `StockExitsService`, `CashHandoverService`, and any future `CashTransferService` all call into it; none of them write to ledger/balance tables themselves. This is the enforcement mechanism for Invariant 4 in §2.

**Should there be a `LedgerService`?** Yes, as above — this is the central recommendation of this entire document.

**Should `PaymentService`/`WarehouseSaleService`/`StockExitsService` write directly?** No, for ledger/balance concerns. They continue to own their own business documents (`Payment`, `Invoice`, `StockExit`) exactly as today — only the cash-movement side of their work is delegated out.

**Receiver resolution as a shared concern:** the "given a picked name/id, resolve it to a real, active, cash-capable `User`" logic should live once (in a `ReceiverService` or as an extension of the existing `UsersService`), consumed identically by every page's receiver picker. This is the direct fix for the fact that three frontend pages today each independently (and inconsistently) implement "find the receiver's id from the list" — one correctly, two not at all (Audit §1).

---

## 8. Currency Strategy

**Option A — store balances pre-converted to USD.** Simplest ledger shape, but loses the ability to know exactly how many physical LBP bills vs. USD bills a Holder has — which is operationally what a handover needs (you count each currency's physical cash separately). Rejected.

**Option B — store balances per-currency, never converted at write time.** Matches physical reality: a cash box has a USD compartment and an LBP compartment; a Holder's "balance" is really two independent numbers. Conversion only ever happens at *reporting* time, on demand, for whichever aggregate view needs a single number.

**Option C — historical rate snapshot per entry.** Every Ledger Entry stamps the exchange rate in effect when it was created (exactly the pattern `Invoice.exchangeRateSnapshot` already establishes elsewhere in this codebase). This means a report asking "what was this LBP collection worth in USD at the time" gets a historically stable answer, independent of today's rate — while a report asking "what is everything worth right now" can still explicitly use the live rate.

**Recommendation: B + C together.** Per-currency ledger and balances as the source of truth; every entry additionally stamped with its rate-at-creation for historical reporting; all cross-currency aggregate figures (an "all balances, in USD" dashboard total, a P&L cash-collected line) computed at query time by explicit, consistent conversion — choosing the entry's own stamped rate for historical accuracy or the live rate for a "right now" view, depending on what the specific report is asking. This is not a new invention — it is the exact distinction the current `ReportsService.getProfitLoss()` already correctly draws between its invoice-revenue line (uses each invoice's own snapshot) and its other lines (uses the live rate); this architecture simply applies that same, already-proven pattern to the cash ledger, which today has no currency awareness at all.

---

## 9. Validation Rules

- A cash-affecting operation must reference a real, existing `User` who is currently cash-capable and active. A free-text name is never an acceptable substitute for this reference, anywhere.
- A Handover's Actual Cash amount cannot be negative.
- A Handover against a zero balance with a zero Actual amount is a no-op and should be rejected (nothing to reconcile).
- A Handover against a positive balance with a zero Actual amount is allowed, but must require a mandatory reason (this is "nothing was handed over" — a full shortage — not an error case, but it must be explained).
- Ledger Entries are never edited or deleted via any API surface. Corrections/reversals are always new entries.
- Corrections/reversals require `owner` role and a mandatory reason, regardless of who was permitted to create the original entry.
- Every Ledger Entry requires: currency, amount, type, a real reference to its originating document, a date, and who recorded it.
- A Cash Transfer requires both a valid source Holder and destination Holder, in the same currency; transferring more than the source Holder's balance should be blocked by default (an explicit `owner`-only override may exist for rare legitimate edge cases, but is never the default path).
- Deactivating a Holder with any nonzero currency balance is blocked until that balance is either handed over or explicitly, auditably written off by an `owner`.

---

## 10. Security Rules

| Action | Allowed roles | Notes |
|---|---|---|
| Collect cash (create a Collection Event with a Holder attached) | `owner`, `accountant`, `sales_rep`, `worker` (worker restricted to non-sale contexts, unchanged from today) | matches current model |
| Transfer cash between Holders | `owner`, `accountant` | narrower than "collect" — this moves custody without an external sale behind it |
| Confirm a Handover | `owner`, `accountant` | matches current model |
| Reverse / correct a Ledger Entry | `owner` only | new, stricter than anything that exists today because nothing like it exists today |
| Archive / deactivate a Holder | `owner` only | matches current receiver-management gating |
| View all Holders' balances | `owner`, `accountant` | matches current model |
| View one's own balance | any authenticated role holding cash | not present today (today's balance endpoints are owner/accountant-only with no self-service view) — a reasonable transparency addition, not a requirement |

---

## 11. Reporting Architecture

Dashboard, Reports, Cash Handover, Receiver Balances, Activity Feed, and any future Daily/Monthly Summary must all obtain their money figures from the same small set of `LedgerService`/reporting-layer query functions — parameterized by date range, Holder, and currency-conversion mode (historical-rate vs. live-rate) — rather than each independently querying `Payment`/`AccountEntry` with its own ad hoc SQL or in-memory reduce.

Concretely: "total cash collected in USD-equivalent for date range X" must be **one function**, called by both the AR summary and the Dashboard/Reports page. This directly closes Audit §10's finding that Dashboard and Reports currently show two different "total collected" numbers for what a user assumes is the same fact, because they're computed by two different code paths with two different currency-handling behaviors.

The Activity Feed, which describes individual events rather than aggregating money, may continue reading source tables directly (`Payment`, `StockExit`, etc.) for its timeline — but any dollar subtotal it displays should still route through the shared currency-conversion helper, not reimplement its own.

---

## 12. Future Scalability

**Multiple warehouses / branches / drawers.** Today, a Holder is exclusively a person; there is no location dimension anywhere in the money-flow schema. The clean extension: a "Holder" becomes an interface with two kinds — a *person-Holder* (today's User) and a *location-Holder* (a drawer/branch/safe). Every mechanic in this document — Ledger Entry, Balance, Transfer, Handover — already works unchanged for either kind, because nothing in the design assumes "Holder = person" at the primitive level, only at the current *population* of Holders. Adding drawers later is additive (a new Holder subtype), not a redesign.

**Multiple currencies beyond USD/LBP.** The per-currency ledger (§8) already generalizes to any number of currencies without schema changes — `currency` is a column value, not a structural assumption baked into separate tables.

**Bank deposits.** A Handover to "the bank" instead of "the accountant" is the same primitive — the destination of custody is a detail, not a different mechanism. `bank_transfer`/`cheque` payments already bypass the Holder concept entirely (§1) since they're direct-methods; this scales to more direct methods (e.g., a payment gateway) with zero change to the ledger core.

**Cash transfers between drawers/branches.** Once Holder generalizes to include locations (above), person-to-person and drawer-to-drawer transfers are the identical `recordTransfer` operation.

**Mobile money, additional payment methods.** New `PaymentMethod` values slot in by declaring, per method, whether it's a holding method (needs a Holder) or a direct method (doesn't) — a one-line classification, not a new code path.

None of the above requires touching the Ledger Entry schema itself, the balance-derivation logic, or the Handover mechanics — they all extend by adding new *kinds* of Holder or new *values* of an already-generic field, which is the entire point of designing the primitives this way now.

---

## 13. Data Integrity — Invariants

1. Every cash-affecting business event involving a Holder produces exactly one Ledger Entry (or exactly one linked debit/credit pair, for transfers), written in the same transaction as the business event.
2. A Ledger Entry is created once and never updated or deleted, by any code path, for any reason.
3. A Holder's Cash Balance, per currency, always equals the signed sum of that Holder's Ledger Entries in that currency — whether read live or served from a cache whose only writer is the same transaction that wrote the entry.
4. No nonzero balance may exist without at least one Ledger Entry that explains it.
5. A Handover's Expected Cash is always computed server-side from the ledger at confirmation time — it is never accepted as client input.
6. Corrections and reversals are always new, clearly-typed entries referencing what they correct — never mutations of history.
7. Every Ledger Entry is traceable to exactly one real, foreign-key-enforced originating business document (Payment, StockExit, CashHandover, CashTransfer, etc.) — never a bare, unenforced string.
8. Deactivating or archiving a Holder never deletes or hides their Ledger Entries; hard deletion is permitted only when zero Ledger Entries reference that Holder.
9. History must always be fully reproducible: given only the Ledger Entry table, it must be possible to reconstruct every Holder's balance at any point in time, with no dependency on any cached or derived value having been correct at the time.

---

## 14. Final Blueprint

### Summary of the architecture
A single, currency-aware, append-only Ledger Entry table is the sole source of truth for "who is holding how much cash." Every module that causes a cash movement — client payments, warehouse sales, future transfers, handovers, corrections — delegates the actual ledger write to one central `LedgerService`, inside its own transaction, referencing a real `User` as the Holder every time (never a name string). Balances are either computed on demand or cached under a strict single-writer discipline with a standing reconciliation tool. Cash Handover computes "expected" itself from the ledger and never trusts the frontend for that number; expenses become real ledger transactions recorded when they happen, not a fudge factor invented at handover time; any shortfall or overage is posted as its own auditable correction, never silently absorbed. Currency is never mixed — each entry carries its own currency and a rate snapshot, and all cross-currency aggregates are computed explicitly and consistently at query time through one shared reporting layer, so Dashboard and Reports can never show two different numbers for the same fact again.

### Cash flow diagram (composite)
```
                     ┌────────────────────────────┐
                     │   Collection Event sources  │
                     │  (Client Payment, Warehouse │
                     │   Sale, future POS/channels) │
                     └──────────────┬─────────────┘
                                    │ holding method + Holder resolved (real User.id)
                                    ▼
                          LedgerService.recordCollection
                                    │
                                    ▼
                     Ledger Entry (credit, currency-tagged, rate-stamped)
                                    │
                                    ▼
                       Holder Balance (derived, per currency)
                                    │
                     ┌──────────────┼──────────────────┐
                     ▼              ▼                  ▼
              Cash Transfer   Cash Handover      Expense deduction
             (peer Holder)   (to custody)        (real ledger entry,
                     │              │              nets balance before
                     ▼              ▼              handover time)
              debit + credit   Expected (server) vs Actual (counted)
              (linked pair)          │
                                     ▼
                        debit (Actual) + correction (Difference, if any)
                                     │
                                     ▼
                          Holder Balance settles
```

### Migration strategy (incremental, non-disruptive)
1. **Centralize first, change nothing behaviorally.** Introduce `LedgerService` wrapping today's `creditAccount`/`debitAccount` logic; move `PaymentService`/`StockExitsService`/`WalkInSalesService` to call it instead of importing the loose functions. No schema change yet — this alone fixes nothing user-visible but removes the "three services, two ad hoc helpers" shape.
2. **Fix receiver resolution once, centrally.** Add the shared receiver-resolution helper (§7) and route `ClientDetail`/`FillClientDetail`/anonymous-warehouse-sale receiver pickers through it, so all four flows resolve a real `User.id` instead of three of them silently degrading to a name string. This is the single highest-value change and can ship independently of everything else.
3. **Add currency to the ledger.** Add `currency` (and rate snapshot) to the ledger table; backfill existing rows as USD (matching how other currency-retrofit migrations in this codebase were already handled, per the audit's references to "legacy rows backfilled USD" in the P&L queries). Split cached balances (if kept) into per-currency rows.
4. **Rebuild Cash Handover's expected-cash computation server-side**, remove client-trusted `expectedAmt`, and move ad hoc handover-time expenses into real ledger transactions recorded at the time they occur.
5. **Decouple Holder capability from Role**, closing the Worker/User balance split and enabling any role to hold cash where the business needs it.
6. **Add the reconciliation/recalculate admin tool** as a standing integrity safeguard, independent of whether a cache is kept.
7. **(Later, as needed)** generalize Holder to include locations/drawers for multi-branch scale; add Transfer/Refund/Advance as their own entry types once a real business need for them arises.

### Risks of not doing this
Every risk catalogued in the prior audit (§13 there) persists and compounds as the feature is extended: more UIs will be built assuming "pick a receiver" already means "credits their balance," when today it only does so one way out of four; currency mixing will corrupt real balances the moment any LBP-collecting flow is wired up at volume; and every new report will be one more place independently reinventing "total collected," each with its own chance of disagreeing with the others.

### Final recommendation
Treat this document's `LedgerService` + per-currency Ledger Entry + server-computed Expected Cash as non-negotiable before any further receiver-balance feature work proceeds. Everything else here — Holder-as-capability, Transfers, location-Holders, the reconciliation tool — can be phased in incrementally without revisiting the core primitive, which is exactly why it's worth getting right now rather than patching the current three-different-implementations shape one more time.

---

*This document defines target architecture only. It does not describe, and should not be read as describing, the system as it exists today — see `RECEIVER_BALANCE_CASH_HANDOVER_AUDIT.md` for that. No files were modified to produce this specification.*
