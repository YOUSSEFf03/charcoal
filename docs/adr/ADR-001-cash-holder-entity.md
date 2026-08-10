# ADR-001: Why `CashHolder` Exists as a Dedicated Entity

**Status:** Accepted (see `CASH_MANAGEMENT_FINAL_BLUEPRINT.md` §1, §6)

## Context

The original architecture spec modeled a cash-holding entity as a *capability of `User`* — anyone who could log in could, in principle, hold cash, with no separate table. That worked for people, but the business's own stated future needs (multiple warehouses, cash drawers, safes, vehicles carrying float, bank accounts as counterparties for deposits) include holders that are not people at all. None of those have a login, an email, a Clerk identity, or a `Role`.

The first-draft spec claimed extending "Holder" to these cases would be "additive, not a redesign," while simultaneously stating, as a hard invariant, that a ledger entry's holder is always a foreign key to `User.id`. Those two statements contradict each other. A peer review of the spec caught this directly.

## Decision

`CashHolder` is a standalone entity. It has a `type` (`person | drawer | safe | vehicle | bank_account | branch`), an optional 1:1 relationship to `User` (populated only when `type = person`), and a display label. Every `LedgerEntry`, `CashHandover`, `CashTransfer`, `CashAdvance`, `OpeningFloat`, and `CashCount` references `CashHolder.id` — never `User.id` directly.

## Consequences

**Positive:**
- One consistent foreign key everywhere in the money-flow schema; no "is this holder a person or something else" branching in any service.
- Drawers, safes, vehicles, and bank accounts can be introduced later by inserting a new `CashHolder` row — no migration touching existing ledger data.
- Deactivating or archiving a holder is a lifecycle operation on one table, independent of whatever identity/auth system `User` uses.

**Negative:**
- One extra join between a `User` and their cash-holding identity, in every query that needs both.
- A backfill migration is required to create one `CashHolder` row per existing cash-capable `User` before the rest of the system can reference it (see Implementation Roadmap, Phase 2).

## Alternatives Considered

- **`User` capability flag** (the original spec's approach): rejected — cannot represent non-person holders without abusing the `User`/auth model.
- **Polymorphic reference without a real table** (a `holderType` + `holderId` pointing at different tables depending on type): rejected — this reintroduces the exact "unenforced reference" problem the underlying audit found in the pre-existing system (`AccountEntry.referenceId` as a bare string). A single real table with a `type` column keeps one enforceable foreign key everywhere.

## Why This Matters Later

If someone asks "why isn't the receiver just a `User`?" — the answer is: because the day this business adds a second warehouse, a cash drawer, or a company bank account as something cash moves to/from, a `User`-only model requires migrating every historical ledger row to a new reference type. `CashHolder` was introduced specifically to make that day a non-event.
