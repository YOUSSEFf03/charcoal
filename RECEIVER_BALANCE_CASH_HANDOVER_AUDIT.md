# Receiver Balance & Cash Handover — Architecture Audit

Investigation only. No code was modified to produce this report. All findings are backed by exact file/line references, verified by reading the source and (where noted) by live testing against the running dev backend/database.

---

## 0. Executive Summary

The system has **one real ledger** (`UserAccount` + `AccountEntry`) that is supposed to answer "how much cash is each person holding right now." In practice, **only one of four receiver-selection UIs actually feeds it**:

| UI | Sends `receiverId`? | Credits the ledger? |
|---|---|---|
| Warehouse Sales → registered-client sale (`WarehouseSales.tsx`) | ✅ Yes | ✅ Yes |
| Warehouse Sales → anonymous sale ("collected by") | ❌ No (name only) | ❌ No |
| Client Detail → Record Payment | ❌ No (name only) | ❌ No |
| Fill Client Detail → Record Payment | ❌ No (name only) | ❌ No |

So the balances shown in Cash Handover are **only ever correct for cash collected through registered-client warehouse sales.** Every other place a "receiver" can be picked in the UI stores a display name and nothing else — no balance is created, no error is thrown, nothing tells the user this happened. This is why the feature "appears to work": the one path that was tested is also the one path that was wired up correctly.

Beyond that gap, three more structural issues were found:
- **Currency is not tracked on the ledger.** USD and LBP amounts are added into the same `Decimal` balance as raw numbers. A receiver who collects $50 and ₤4,500,000 shows a balance of 4,500,050.
- **Editing a stock exit's amount never touches the ledger.** `updateExit()` writes straight to `StockExit.amount`, bypassing `creditAccount`/`debitAccount` entirely.
- **Cash handover has no server-side authority over "expected."** The frontend computes it and the backend stores whatever it's given.

Full detail follows.

---

## 1. Receiver System — every place a receiver can be selected

### 1.1 Warehouse Sales — registered client, packed bags (works correctly)
**Files:** `src/pages/WarehouseSales.tsx:325-338`, `apps/backend/src/walk-in-sales/walk-in-sales.controller.ts`, `apps/backend/src/walk-in-sales/walk-in-sales.service.ts`

```
src/pages/WarehouseSales.tsx:328
const receiverId = allReceivers.find(r => r.name === receiver && r.role === 'receiver')?.id
```
- **Why it exists:** attribute the cash collected for an invoiced sale to the staff member who physically took it, so it can later be handed over.
- **API called:** `POST /walk-in-sales` (`WalkInSalesController.create`, `@Roles('owner','sales_rep')`).
- **DB fields written:** `Payment.receiverId`, `Payment.receiverName`, plus `StockExit.invoiceId` (all lines), `Invoice.*`.
- **Services executed:** `WalkInSalesService.create()` → inside one `$transaction`: creates `Invoice`, creates `StockExit` rows (amount always `null`), creates `Payment` (only if `receivedUsd`/`receivedLbp` > 0), then **`creditAccount(tx, receiverId, received, 'payment_received', payment.id, ..., date)`** (`walk-in-sales.service.ts:230-239`).
- **Balance affected:** `UserAccount.balance` for the resolved `receiverId`, plus one `AccountEntry` row. **This is the only fully-wired path in the app.**

### 1.2 Warehouse Sales — registered client, by-kg (works correctly)
Same file, `src/pages/WarehouseSales.tsx:423-438`. Identical mechanism, same `WalkInSalesService.create()`, same ledger effect.

### 1.3 Warehouse Sales — anonymous sale, "Received by" (does NOT touch the ledger)
**Files:** `src/pages/WarehouseSales.tsx:395` (packed) and `:466` (by-kg), `apps/backend/src/stock-exits/stock-exits.service.ts:187-304`

```
src/pages/WarehouseSales.tsx:395
...(receiver ? { collectedBy: receiver } : {}),
```
Note: **no `collectedById` lookup at all** — unlike the registered-client branches a few lines above in the same file, this path never resolves the picked name back to a `User.id`.
- **Why it (nominally) exists:** record who at the warehouse took cash for an anonymous walk-in sale.
- **API called:** `POST /stock-exits` (`StockExitsController.create`, `@Roles('owner','sales_rep','worker')`).
- **DB fields written:** `StockExit.collectedBy` (name string only). `StockExit.collectedById` stays `null`.
- **Services executed:** `StockExitsService.create()` — the ledger-credit block exists (`stock-exits.service.ts:290-300`) but is gated on `collectorFields.collectedById`, which is never populated by this UI, so it never fires:
```
stock-exits.service.ts:291
if (collectorFields.collectedById && dto.amount != null && dto.amount > 0) {
  await creditAccount(tx, collectorFields.collectedById, ...)
}
```
- **Balance affected:** none. Dead code path from the frontend's perspective. (Also compounded by a separate, pre-existing issue found earlier this session: the anonymous packed-bag branch never sends `amount` at all — see §13.)

### 1.4 Client Detail → "Record Payment" (does NOT touch the ledger)
**File:** `src/pages/ClientDetail.tsx:148-155, 293-296, 462-466, 1300-1306`

```
ClientDetail.tsx:150-154
const allReceivers = [
  ...(workersQ.data ?? []).map(w => w.name),
  ...customReceivers.map(r => r.name),
  'Owner',
]
...
ClientDetail.tsx:1303-1306
<select className="select" value={payReceiverName} onChange={...}>
  <option value="">— select receiver —</option>
  {allReceivers.map(r => <option key={r}>{r}</option>)}
</select>
```
`allReceivers` here is a flat array of **strings** (worker names + receiver names + the literal `'Owner'`), not objects with an `id`. The selected value is submitted as:
```
ClientDetail.tsx:465
receiverName: payReceiverName || undefined,
```
`receiverId` is **never sent**.
- **Why it exists:** record who accepted payment against a client's invoice/order balance.
- **API called:** `POST /payments` (`PaymentsController.create`, `@Roles('owner','accountant','sales_rep')`).
- **DB fields written:** `Payment.receiverName` only.
- **Services executed:** `PaymentsService.create()` (`payments.service.ts:158-165`):
```
if (dto.receiverId) { ... receiverFields = { receiverId, receiverName } }
else if (dto.receiverName) { receiverFields = { receiverName: dto.receiverName } }
...
if (receiverFields.receiverId) { await creditAccount(...) }   // never true from this UI
```
- **Balance affected:** none. The payment is fully recorded (correct for client accounting), but the named "receiver" never accumulates a ledger balance and can never be reconciled via Cash Handover.

### 1.5 Fill Client Detail → "Record Payment" (does NOT touch the ledger)
**File:** `src/pages/FillClientDetail.tsx:1346-1372, 1398-1403`

Same defect as §1.4, with an even more misleading UI: the `<select>` is populated from real `User` records (`usersList`, `receivers`) whose `id` is available as the React `key`, but the bound `value`/submitted field is the **name**:
```
FillClientDetail.tsx:1367
<option key={r.id} value={r.name}>{r.name}{r.role ? ` · ${r.role}` : ''}</option>
...
FillClientDetail.tsx:1401
receiverName: payBy || undefined,
```
- **API called:** `POST /payments`, same as above.
- **Balance affected:** none, same reason.

### 1.6 Cash Handover → receiver picker (correct — but see §4 for other issues)
**File:** `src/pages/CashHandover.tsx:31-38, 147-171`

```
CashHandover.tsx:38
const selectedReceiverName = allBalances.find(b => b.userId === selectedReceiver)?.name ?? ''
```
Here `selectedReceiver` **is** a real `User.id`, sourced from `GET /cash-handovers/balances` (`b.userId`). This is correctly wired.
- **API called:** `GET /cash-handovers/balances`, `GET /cash-handovers/balance/user/:id`, `POST /cash-handovers`.
- **Balance affected:** `UserAccount.balance` is **decremented** (via `debitAccount`), see §4.

### 1.7 Settings → "Money receivers" (admin CRUD, not a money-recording flow)
**File:** `src/pages/Settings.tsx:335-405`, `apps/backend/src/users/users.controller.ts`, `users.service.ts`

This section creates/renames/deletes `User` rows with `role='receiver'` via `POST /users`, `PATCH /users/:id/name`, `DELETE /users/:id`. It doesn't move money, but it directly determines who shows up in every picker above, and deleting a receiver here **hard-deletes their `UserAccount`/`AccountEntry` history** — see §5 and §13.

### Files involved (receiver selection, complete list)
- `src/pages/WarehouseSales.tsx`
- `src/pages/ClientDetail.tsx`
- `src/pages/FillClientDetail.tsx`
- `src/pages/CashHandover.tsx`
- `src/pages/Settings.tsx`
- `src/pages/Invoices.tsx` (display-only — shows `payment.receiverName` in history, no selection)
- `src/hooks/useReceivers.ts`, `useUsers.ts`, `usePayments.ts`, `useWalkInSales.ts`, `useWarehouse.ts`, `useCashHandover.ts`
- `apps/backend/src/payments/{payments.service.ts,payments.controller.ts,dto/create-payment.dto.ts}`
- `apps/backend/src/stock-exits/{stock-exits.service.ts,stock-exits.controller.ts,dto/create-stock-exit.dto.ts}`
- `apps/backend/src/walk-in-sales/{walk-in-sales.service.ts,walk-in-sales.controller.ts}`
- `apps/backend/src/cash-handovers/{cash-handovers.service.ts,cash-handovers.controller.ts}`
- `apps/backend/src/users/{users.service.ts,users.controller.ts}`

---

## 2. User Balance System

**File:** `apps/backend/prisma/schema.prisma:832-878`

### `UserAccount` (one row per user who has ever collected money)
```prisma
model UserAccount {
  id        String         @id @default(uuid())
  userId    String         @unique
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  balance   Decimal        @default(0) @db.Decimal(10, 2)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  entries   AccountEntry[]
}
```
- **Purpose:** denormalized running balance for O(1) reads ("how much is this person holding right now").
- **Stored, not computed** — `balance` is a real column, updated with `increment`/`decrement` at write time.
- **No `currency` column.** This is a real gap — see §6.
- **Created lazily:** first `upsert` call from `creditAccount`/`debitAccount` creates the row; a user who has never collected/handed over money has no `UserAccount` row at all (`getReceiverBalance` handles this by falling back to `new Decimal(0)`).

### `AccountEntry` (append-only ledger)
```prisma
model AccountEntry {
  id          String           @id @default(uuid())
  accountId   String
  account     UserAccount      @relation(fields: [accountId], references: [id], onDelete: Cascade)
  amount      Decimal          @db.Decimal(10, 2) // positive = credit, negative = debit
  type        AccountEntryType // payment_received | sale_collected | handover
  referenceId String?          // Payment / StockExit / CashHandover id — not a real FK
  description String?
  date        DateTime         @db.Date
  createdAt   DateTime         @default(now())
}
```
- **Purpose:** full history of every credit/debit, for the per-receiver breakdown shown in Cash Handover.
- **`referenceId` is a plain string, not a foreign key** — there is no DB-level guarantee it points to a real `Payment`/`StockExit`/`CashHandover` row, and no cascading behavior if that row is later deleted (it currently can't be, see §11, but nothing in the schema enforces that).
- **No `currency` field** — same gap as `UserAccount.balance`.

### How balance is calculated
Two helper functions in `apps/backend/src/cash-handovers/cash-handovers.service.ts:6-40` are the **only** writers:
```ts
async function creditAccount(tx, userId, amount, type, referenceId, description, date) {
  const account = await tx.userAccount.upsert({
    where: { userId },
    update: { balance: { increment: amount.toNumber() } },
    create: { userId, balance: amount.toNumber() },
  });
  await tx.accountEntry.create({ data: { accountId: account.id, amount: amount.toFixed(2), type, referenceId, description, date } });
}

async function debitAccount(tx, userId, amount, referenceId, date) {
  const account = await tx.userAccount.upsert({
    where: { userId },
    update: { balance: { decrement: amount.toNumber() } },
    create: { userId, balance: amount.negated().toNumber() },
  });
  await tx.accountEntry.create({ data: { accountId: account.id, amount: amount.negated().toFixed(2), type: 'handover', referenceId, description: 'Cash handover', date } });
}
```
Every call site (verified by `grep` across the whole backend — exactly 4 call sites exist):
1. `payments.service.ts:185` — `creditAccount`, only when `dto.receiverId` was sent (§1.4/1.5 never send it).
2. `stock-exits.service.ts:292` — `creditAccount`, only when `dto.collectedById` was sent (§1.3 never sends it).
3. `walk-in-sales.service.ts:236` — `creditAccount`, always fires when `receiverId` + `received > 0` (§1.1/1.2 — the one working path).
4. `cash-handovers.service.ts:196` — `debitAccount`, on every handover creation.

Both helpers always pair the `UserAccount` update with an `AccountEntry` insert **inside the same transaction**, so *given only these four call sites*, `UserAccount.balance` is mathematically guaranteed to equal `SUM(AccountEntry.amount)` for that account. The invariant is broken by two things found elsewhere in the codebase: `updateExit()` (§5) and the Settings receiver-delete cascade (§5/§13).

### Read paths
- `CashHandoversService.getAllBalances()` (`cash-handovers.service.ts:69-83`) — `userAccount.findMany({ where: { balance: { gt: 0 } } })`, one query, sorted desc. Docstring claims "Three aggregation queries" (`cash-handovers.controller.ts:27`) — **stale comment**, the implementation is a single `findMany`.
- `CashHandoversService.getReceiverBalance(id)` (`cash-handovers.service.ts:89-155`) — reads `UserAccount.balance` directly for the headline number, but **separately re-derives** `totalCollected`/`totalHandedOver` by summing `AccountEntry.amount` in JS (lines 126-130). Two different code paths computing overlapping numbers from the same table — not a bug today given the invariant above, but a duplicate calculation (see §10).

---

## 3. Money Flow — every traced path

### Path A — Registered-client warehouse sale (the only fully-consistent path)
```
WarehouseSales.tsx (buyer = registered client, packed or kg)
  → POST /walk-in-sales                                   [walk-in-sales.controller.ts]
    → WalkInSalesService.create()                          [walk-in-sales.service.ts:43-248]
      TRANSACTION:
        1. Invoice.create        (status=issued, source=WAREHOUSE_SALE)
        2. StockExit.create × N  (amount=null, invoiceId=invoice.id)   — one per FIFO-split packed-stock record
        3. PackedStock/StockLot updated (decrement quantity / kgRemaining)
        4. if received > 0:
             Payment.create (invoiceId, receiverId?, amount=received in CLIENT currency)
             Invoice.paidAmount/status recomputed
             if receiverId: creditAccount(tx, receiverId, received, 'payment_received', payment.id, ...)
                → UserAccount.balance += received   (raw number, no currency tag)
                → AccountEntry.create(+received)
             if receiverId: creditAccount() also calls (inside the same helper file, not shown above)
      returns Invoice + Payment
```
Frontend cache invalidation on success (`useCreateWalkInSale`, `src/hooks/useWalkInSales.ts:59-73`): `stock-exits`, `invoices`, `payments`, `clients`, `packed-stock*`, `warehouse.walk-in-summary`, `stock-lots`, and the specific client's balance. **It does not invalidate `cash-handovers`/`cash-handovers.balances`/`cash-handovers.balance.<receiverId>`** — so the Cash Handover page (if already open in another tab) will not automatically refresh a receiver's new balance from this sale (30s polling on `useAllBalances` eventually catches it; `useReceiverBalance` has no polling — see §13).

### Path B — Anonymous warehouse sale with "Received by" set
```
WarehouseSales.tsx (buyer = walk-in, receiver picked from dropdown)
  → POST /stock-exits                                      [stock-exits.controller.ts]
    → StockExitsService.create()                            [stock-exits.service.ts:187-304]
      TRANSACTION:
        StockExit.create (collectedBy = NAME STRING, collectedById = undefined)
        [credit block never fires — collectedById is falsy]
      returns StockExit
```
**No UserAccount/AccountEntry write occurs.** Money "collected" here is invisible to the ledger and to Cash Handover.

### Path C — Client Detail / Fill Client Detail "Record Payment"
```
ClientDetail.tsx or FillClientDetail.tsx (receiver picked from dropdown, by name)
  → POST /payments                                          [payments.controller.ts]
    → PaymentsService.create()                               [payments.service.ts:107-211]
      TRANSACTION:
        Payment.create (receiverName = NAME STRING, receiverId = undefined)
        if invoiceId: Invoice.paidAmount/status recomputed
        [credit block never fires — receiverId is falsy]
      returns Payment
```
Same gap as Path B — a real cash collection event that never reaches `UserAccount`.

### Path D — Cash Handover
```
CashHandover.tsx (receiver = real User.id from balances list)
  → POST /cash-handovers                                    [cash-handovers.controller.ts:39-53]
    → CashHandoversService.create()                          [cash-handovers.service.ts:157-200]
      expected  = dto.expectedAmt   (CLIENT-COMPUTED, trusted as-is)
      handed    = dto.handedAmt     (CLIENT-COMPUTED, trusted as-is)
      diff      = handed − expected
      TRANSACTION:
        CashHandover.create(date, receiverId, receiverName, expectedAmt, handedAmt, difference, notes, loggedById)
        debitAccount(tx, receiverId, handedAmt, handover.id, date)
          → UserAccount.balance -= handedAmt
          → AccountEntry.create(-handedAmt, type='handover')
      returns CashHandover
```
The backend **never reads `UserAccount.balance` itself** to validate or compute `expectedAmt` — it only uses `handedAmt` to debit. See §4 for the full implication.

### Full lifecycle (client-pays example, annotated with what's real vs assumed)
```
Client pays cash at the counter for a registered-client warehouse sale
   ↓
Invoice + StockExit(s) created, Payment created with receiverId  ✅ real, atomic
   ↓
creditAccount() → UserAccount.balance += amount (unconverted)    ⚠ currency dropped
   ↓
Receiver walks around all day collecting more cash from:
   - other warehouse sales with receiver picked correctly         ✅ adds to same balance
   - anonymous sales with receiver picked                         ❌ invisible, not added
   - client/fill-client payments with receiver picked             ❌ invisible, not added
   ↓
End of day: Cash Handover page shows UserAccount.balance          ⚠ understates true cash held
   ↓
Owner/accountant enters an "expected" figure (client-computed) and a "handed" figure
   ↓
POST /cash-handovers → debitAccount(handedAmt)                     ✅ real, atomic
   ↓
UserAccount.balance -= handedAmt  (can go negative — no floor check)
```

---

## 4. Cash Handover — complete audit

**Files:** `src/pages/CashHandover.tsx`, `src/hooks/useCashHandover.ts`, `apps/backend/src/cash-handovers/{cash-handovers.service.ts,cash-handovers.controller.ts}`

### How "collected today" is calculated
`CashHandover.tsx:44-49`:
```ts
const orderCash = dailyPayments
  .filter(p => !((p.notes ?? '') as string).startsWith('[ws]'))
  .reduce((s, p) => s + parseFloat(p.amount), 0)
const saleCash = dailyExits.reduce((s, e) => s + parseFloat(e.amount ?? '0'), 0)
const totalCollected = orderCash + saleCash
```
- `dailyPayments` = `GET /payments?dateFrom=date&dateTo=date` (ALL payments that day, any receiver, any currency — **summed without currency conversion**).
- `dailyExits` = `GET /stock-exits?exitType=walk_in&dateFrom=date&dateTo=date`, filtered client-side to `amount != null`.
- **The `[ws]` filter is dead code.** `grep -rn "\[ws\]"` across the entire repo returns exactly these two lines (the filter and its comment) — nothing anywhere ever writes a `[ws]`-prefixed note. The comment claims this exists to avoid double-counting warehouse-sale payments that are "already in saleCash via exits," but that premise is also false: invoiced warehouse-sale exits always have `amount = null` (§3 Path A step 2), so they're excluded from `saleCash` on their own merit. Today this doesn't cause a live double-count, but it is a nonexistent safeguard described as real — a hazard for whoever next touches this code.

### How "expected handover" is calculated
`CashHandover.tsx:52-56`:
```ts
const receiverTotal = selectedReceiver && receiverBalance ? parseFloat(receiverBalance.balance) : totalCollected
const expected = receiverTotal - manualExpTotal
```
Two entirely different bases depending on UI state:
- **No receiver selected:** `expected` = today's date-filtered collections (`totalCollected`) minus expenses.
- **Receiver selected:** `expected` = that receiver's **entire historical running balance** (`receiverBalance.balance`, not date-filtered at all) minus expenses.

The date picker at the top of the page implies everything shown is scoped to `selectedDate`; in the receiver-selected mode it silently is not. A receiver who has been collecting cash for a week without a handover would show their full week's balance as "expected handover" for whatever single date happens to be selected.

### How expenses are deducted
`CashHandover.tsx:18-19, 54-56, 330-363`: `expenses` is **pure React component state** (`useState<Expense[]>([])`), never sent to any API. `manualExpTotal` is subtracted from `expected` client-side only. On `confirmHandover()` (`CashHandover.tsx:72-86`), only the net `expected` figure is POSTed — **the itemized expense list is discarded**, not persisted anywhere (no `expenses` field exists on `CashHandover` in the schema). A refresh mid-session loses the entered expenses; there is no audit trail of what was deducted or why, beyond whatever the user types into the freeform `notes` field.

### How the handover is confirmed
`CashHandover.tsx:72-86` → `useCreateCashHandover` → `POST /cash-handovers` → `CashHandoversService.create()` (`cash-handovers.service.ts:157-200`, walked through in §3 Path D). Guarded by `@Roles('owner','accountant')` at the controller level (`cash-handovers.controller.ts:12`).

**No server-side validation that `expectedAmt` matches `UserAccount.balance` for that receiver.** The backend trusts whatever `expectedAmt`/`handedAmt` the client sends; `difference` is derived from those two client-supplied numbers, not cross-checked against the ledger. Also note: the inline DTO type on `create()` (`cash-handovers.controller.ts:42-49`) is a plain TypeScript object literal, **not a class-validator-decorated class** — there is no `CreateCashHandoverDto` file. Because NestJS's `ValidationPipe` only enforces `class-validator` decorators, and none exist here, **this endpoint has no input validation at all**: `receiverId` is never checked for UUID shape, `expectedAmt`/`handedAmt` are never checked for being numeric strings, `date` is never checked for ISO format. A malformed body (e.g. `expectedAmt: "abc"`) would `parseFloat` to `NaN`, propagate into `expected.toFixed(2)` → `"NaN"`, and get written into the `Decimal` column (Postgres will likely reject it at the driver level, surfacing as an unhandled 500 rather than a clean 422).

### What rows are created
One `CashHandover` row + one `AccountEntry` row (via `debitAccount`). No `UserAccount` row is created if one doesn't already exist (it's `upsert`'d with a starting negative balance in that edge case — see §5).

### What balances are reduced
Only the selected receiver's `UserAccount.balance`, by exactly `handedAmt` (not `expectedAmt` — see §5 for the negative-balance implication).

### What historical records are stored
`CashHandover` rows are permanent — **no `PATCH`/`DELETE` route exists** for them (confirmed: `cash-handovers.controller.ts` only defines `GET`/`GET`/`GET`/`POST`). A data-entry mistake in a handover can never be corrected or reversed through the API; it would require a direct database edit.

---

## 5. Receiver Balances

**How increased:** `creditAccount()`, called only from the three sites in §2 — in practice, only Path A/B (§3) ever fires it live given current frontend wiring.

**How decreased:** `debitAccount()`, called only from `CashHandoversService.create()`, using `handedAmt` (what the frontend says was handed over) — not `expectedAmt`.

**Can balances become negative?** Yes, in at least two ways, both unguarded:
1. `debitAccount` does a plain `decrement` with no floor check. If `handedAmt` (client-typed) exceeds the receiver's true balance, `UserAccount.balance` goes negative with no error.
2. `debitAccount`'s `upsert.create` branch (`cash-handovers.service.ts:35`) explicitly creates an account with `balance: amount.negated()` if none existed — i.e., handing over cash for a receiver who has never collected anything through the one working path is allowed and produces a negative balance from row one.

**Can balances become inconsistent (vs. reality)?**
- `updateExit()` (`stock-exits.service.ts:158-169`) lets `owner`/`sales_rep` edit `StockExit.amount` via `PATCH /stock-exits/:id` — **this never calls `creditAccount`/`debitAccount`**. Two concrete scenarios, both reachable through the existing "enter/edit sale amount" panel in `WarehouseSales.tsx` (`:1194-1225` before my earlier fix this session added the invoice guard, `:1206-1226` after):
  - An anonymous exit created with `amount = null` (the common case per §13) later has an amount typed in via the panel → `StockExit.amount` becomes non-null, but the collector named on it (if any) is **never credited**.
  - An anonymous exit created with `amount = X` (crediting the collector at creation) is later **edited** to `amount = Y` → the ledger still reflects the original `X`, permanently diverged from the displayed `Y`.
  - (My earlier fix this session added a guard in `updateExit` that blocks amount edits on exits with `invoiceId` set — that closes the double-count risk for invoiced sales specifically, but the anonymous-exit gap above is untouched and pre-existing.)
- Deleting a receiver (`DELETE /users/:id`, `users.service.ts:61-70`) is a **hard delete** (`prisma.user.delete`). `UserAccount.user` has `onDelete: Cascade` and `AccountEntry.account` has `onDelete: Cascade` — deleting a receiver **silently erases their entire `UserAccount` + all `AccountEntry` history**, even if `balance > 0` at the time. No confirmation dialog exists in `Settings.tsx` (`removeReceiver(r.id)` fires directly on click, `Settings.tsx:380`), and the service performs no balance check before deleting.

**What prevents double counting?** Nothing systemic beyond the incidental fact that invoiced-sale exits carry `amount = null`. The `[ws]` filter in `CashHandover.tsx` that was clearly *intended* to prevent a specific double-count doesn't actually function (§4).

**What prevents race conditions?** Every credit/debit happens inside a Prisma `$transaction`, and `upsert`+`increment`/`decrement` are atomic at the Postgres row level, so two concurrent writes to the *same* `UserAccount` row will serialize correctly (no lost-update race for the numeric balance itself). No optimistic-locking/version column exists, but none is needed given `increment`/`decrement` are used (not read-modify-write in JS). There is, however, no protection against **logically** concurrent double submission at the application layer (e.g., double-clicking "Confirm handover" before the mutation settles) — `createHandover.isPending` disables the button in the UI (`CashHandover.tsx:424`) but that's a client-side-only guard, not a server-side idempotency key.

---

## 6. Accounting Integrity — is the ledger the single source of truth?

**No.** At least five independent "how much money" concepts exist in this codebase, each computed differently, each serving a different (mostly non-overlapping) purpose:

| Concept | Where | Computed how | Currency-aware? |
|---|---|---|---|
| Receiver cash balance | `UserAccount.balance` | Stored, incremented/decremented | **No** |
| Receiver totalCollected/totalHandedOver (detail view) | `CashHandoversService.getReceiverBalance()` | Re-summed from `AccountEntry` on every call | **No** |
| AR "total collected" | `ReportsService.getArSummary()` (`reports.service.ts:1206-1209`) | `payment.aggregate({_sum:{amount}})`, raw SQL sum, no `$queryRaw` conversion | **No** |
| P&L "cash collected" | `ReportsService.getProfitLoss()` (`reports.service.ts:247-259`) | Raw SQL, converts each row by its own `currency` via the live rate | **Yes** |
| Client balance (AR, not cash) | `ClientBalanceService.computeBalance()` | On-the-fly, `Σ invoice.total − Σ payment.amount`, never stored | Partial (assumes client's own currency throughout) |

The **AR summary's `totalCollected`** and the **P&L's `cashCollected`** are both surfaced to end users and can show visibly different numbers for what a user would assume is "the same thing" — see §10 for exactly where.

**Cached/duplicated values found:**
- `UserAccount.balance` is a cache of `SUM(AccountEntry.amount)` — legitimate denormalization, correctly maintained by the two helper functions, but nothing recomputes/reconciles it from the ledger if it ever drifts (no repair job, no assertion, no admin "recalculate" action).
- `Worker.totalEarned` / `Worker.totalPaid` (`schema.prisma:734-735`) are a **separate, worker-specific** cached balance system, entirely disconnected from `UserAccount` — a worker who is also set up as a "receiver" (possible; `Role` enum treats them as different roles, but nothing stops a person conceptually holding both) would have two completely independent balances tracked in two different tables with no relationship between them.

---

## 7. Database — every model involved

| Model | Purpose | Created by | Updated by | Read by | Editable? | Deletable? |
|---|---|---|---|---|---|---|
| `User` | Identity + role | Clerk webhook / `UsersService.createLocal` | `UsersService.updateRole/updateName`, Clerk webhook (soft-delete via `deletedAt`) | everywhere | Yes (name/role/phone) | **Local users only**, hard delete, cascades to `UserAccount`+`AccountEntry` |
| `UserAccount` | Denormalized cash balance per user | `creditAccount`/`debitAccount` `upsert` (lazy) | same two functions only | `CashHandoversService.getAllBalances/getReceiverBalance` | Never directly (always via credit/debit helpers) | Never directly — only via cascading `User` delete |
| `AccountEntry` | Append-only ledger | `creditAccount`/`debitAccount` | Never (append-only by design) | `getReceiverBalance` | No (no update route) | Never directly — only via cascading `UserAccount`→`User` delete |
| `Payment` | Client payment record | `PaymentsService.create`, `WalkInSalesService.create` | Never | invoices, reports, client ledger, receiver balance detail | No (no update route) | No (no delete route) |
| `StockExit` | Inventory movement + optional sale amount | `StockExitsService.create`, `WalkInSalesService.create` | `StockExitsService.updateExit` (amount, recipient only) | reports, cash handover, receiver balance detail | **Yes — `amount`/`recipient`, but this never touches the ledger** | No (no delete route) |
| `CashHandover` | Historical handover record | `CashHandoversService.create` | Never | `findAll`, `getReceiverBalance` | No (no update route) | No (no delete route) |
| `Invoice` | Billing document | `WalkInSalesService`, orders flow | `paidAmount`/`status` via `InvoiceCalculatorService.recomputeStatus` | everywhere | Status/paidAmount only, system-driven | Not investigated (out of scope) |
| `Worker` | Packing-labor entity, separate balance | workers module | workers module | workers/employees pages | Yes | Not investigated |

---

## 8. API Audit

| Route | Method | Controller | Service | DTO | DB writes | Transaction? | Roles |
|---|---|---|---|---|---|---|---|
| `/walk-in-sales` | POST | `WalkInSalesController` | `WalkInSalesService.create` | `CreateWalkInSaleDto` (class-validator) | Invoice, StockExit×N, Payment?, Invoice update, AccountEntry?, UserAccount? | ✅ single `$transaction` | `owner`, `sales_rep` |
| `/payments` | POST | `PaymentsController` | `PaymentsService.create` | `CreatePaymentDto` (class-validator) | Payment, Invoice update?, AccountEntry?, UserAccount? | ✅ single `$transaction` | `owner`, `accountant`, `sales_rep` |
| `/payments` | GET | `PaymentsController` | `PaymentsService.findAll` | query params | — | read-only `$transaction` (list+count) | `owner`, `accountant`, `sales_rep` |
| `/payments/:id` | GET | `PaymentsController` | `PaymentsService.findOne` | — | — | none | `owner`, `accountant`, `sales_rep` |
| `/stock-exits` | POST | `StockExitsController` | `StockExitsService.create` | `CreateStockExitDto` (class-validator) | StockExit, PackedStock/StockLot decrement, AccountEntry?, UserAccount? | ✅ single `$transaction` | `owner`, `sales_rep`, `worker` |
| `/stock-exits/:id` | PATCH | `StockExitsController` | `StockExitsService.updateExit` | inline type, **no class-validator** | StockExit only | none (single `update` call) | `owner`, `sales_rep` |
| `/stock-exits` | GET | `StockExitsController` | `StockExitsService.findAll` | query params | — | read-only `$transaction` | `owner`, `accountant`, `sales_rep` |
| `/stock-exits/summary` | GET | `StockExitsController` | `StockExitsService.getWalkInSummary` | query params | — | none (2 parallel reads) | `owner`, `sales_rep` |
| `/cash-handovers` | POST | `CashHandoversController` | `CashHandoversService.create` | inline type, **no class-validator, no DTO file** | CashHandover, AccountEntry, UserAccount | ✅ single `$transaction` | `owner`, `accountant` |
| `/cash-handovers` | GET | `CashHandoversController` | `CashHandoversService.findAll` | query params | — | read-only `$transaction` | `owner`, `accountant` |
| `/cash-handovers/balances` | GET | `CashHandoversController` | `CashHandoversService.getAllBalances` | — | — | none | `owner`, `accountant` |
| `/cash-handovers/balance/user/:receiverId` | GET | `CashHandoversController` | `CashHandoversService.getReceiverBalance` | `ParseUUIDPipe` | — | none (4 parallel reads) | `owner`, `accountant` |
| `/users` | POST | `UsersController` | `UsersService.createLocal` | `CreateLocalUserDto` (class-validator) | User | none | `owner` |
| `/users/:id` | DELETE | `UsersController` | `UsersService.deleteLocal` | `ParseUUIDPipe` | User delete → cascades UserAccount, AccountEntry | none (single delete) | `owner` |
| `/users/:id/name` | PATCH | `UsersController` | `UsersService.updateName` | `UpdateUserNameDto` | User | none | `owner` |
| `/users/:id/role` | PATCH | `UsersController` | `UsersService.updateRole` | `UpdateUserRoleDto` | User (+ Clerk metadata if not local) | none | `owner` |

**Two endpoints have zero server-side input validation**: `PATCH /stock-exits/:id` and `POST /cash-handovers`, because both declare their body as an inline TypeScript type rather than a `class-validator`-decorated DTO class.

---

## 9. Frontend Flow

### Warehouse Sales (`src/pages/WarehouseSales.tsx`)
- **Hooks:** `useBagTypes`, `useStockLots`, `usePackedStockSummary`, `useClients`, `useWorkers`, `useReceivers`, `usePackedStockRecords`, `useStockExits`, `useCreateStockExit`, `useUpdateStockExit`, `useWalkInSummary`, `useCreateWalkInSale`, `usePayments` (added this session for the cash-box fix).
- **State → render:** local `useState` for buyer/date/mode/lines/payment fields drives a live total preview; on submit, either `useCreateWalkInSale` (registered client) or `useCreateStockExit` (anonymous) fires; both invalidate a broad set of React Query keys on success (`stock-exits`, `invoices`, `payments`, `clients`, `packed-stock*`, `stock-lots`, `warehouse.walk-in-summary`) which re-triggers the page's own queries automatically.

### Cash Handover (`src/pages/CashHandover.tsx`)
- **Hooks:** `useDailyPayments`, `useStockExits`, `useCashHandovers`, `useAllBalances` (30s poll), `useReceiverBalance` (no poll, keyed by `selectedReceiver`), `useCreateCashHandover`.
- **Data flow:** date/receiver selection are local component state → drive which queries are `enabled`/what params are passed → derived numbers (`orderCash`, `saleCash`, `expected`, `diff`) computed inline in the component body on every render → rendered into the KPI row, the balances strip, the receiver detail table, and the reconciliation panel. Confirming a handover mutates, then invalidates `cash-handovers`, `cash-handovers.balances`, and the specific `cash-handovers.balance.<id>` key.

### Client Detail / Fill Client Detail
- **Hooks:** `usePayments`, `useCreatePayment`, `useReceivers`, `useWorkers`, `useUsers` (Fill Client only). Both build a plain-string receiver list and submit `receiverName`, per §1.4/1.5.

### Settings (`src/pages/Settings.tsx`)
- **Hooks:** `useReceivers` (wraps `useUsers`/`useCreateLocalUser`/`useUpdateUserName`/`useDeleteLocalUser`). Pure CRUD, no balance-related rendering.

### API client
`src/lib/api.ts` — a shared Axios instance (not read in depth for this audit; referenced by every hook above via `api.get/post/patch`).

---

## 10. Consistency Audit — duplicate/divergent balance calculations

1. **"Total collected" shown on Dashboard vs. Reports is not the same number.**
   - `src/pages/Dashboard.tsx:417` renders `plQ.data.cashCollected` — from `getProfitLoss()`, **currency-converted**.
   - `src/pages/Reports.tsx:400` renders `arQ.data.totalCollected` (labeled "Total collected", with a "collection rate") — from `getArSummary()`, **not currency-converted**.
   - If any LBP payments exist, these two pages will display different totals for a concept a user would reasonably assume is identical. Verified by reading both `reports.service.ts` aggregation queries directly (§2/§6 table).

2. **Receiver balance detail re-derives numbers that are also cached.**
   `CashHandoversService.getReceiverBalance()` reads `UserAccount.balance` for the headline figure, then separately re-sums `AccountEntry` rows in JavaScript for `totalCollected`/`totalHandedOver` (`cash-handovers.service.ts:126-130`). Not currently inconsistent (same invariant as §2), but it's two calculations of overlapping information with no shared helper — a future change to one is not guaranteed to be reflected in the other.

3. **`[ws]`-tag double-count guard is nonfunctional** (§4) — a safeguard that exists in comment and filter form but never actually executes, because nothing writes the tag it filters on.

4. **Client balance vs. receiver balance are computed on entirely different bases** and easily confused conceptually (one is "what the client owes," the other is "what cash a staff member is physically holding") — not a bug, but worth flagging since both are called "balance" throughout the UI/code.

---

## 11. Security Audit

- **Who can modify balances?** No one modifies `UserAccount`/`AccountEntry` directly — only indirectly, by creating a `Payment` with `receiverId` (`owner`, `accountant`, `sales_rep`), creating a `StockExit` with `collectedById` (`owner`, `sales_rep`, `worker` — though workers are additionally restricted server-side to non-sale `exitType`s, `stock-exits.service.ts:17,188-193`), or creating a walk-in sale (`owner`, `sales_rep`).
- **Who can confirm handovers?** `owner`, `accountant` only (`cash-handovers.controller.ts:12`, controller-wide `@Roles`).
- **Who can change receivers (create/rename/delete `User` rows)?** `owner` only (`users.controller.ts:50`, controller-wide `@Roles('owner')`).
- **Who can delete payments?** No one — no delete route exists on `PaymentsController`.
- **Who can edit handovers?** No one — no update route exists on `CashHandoversController`.
- **Who can edit a stock exit's amount (the closest thing to editing a sale's recorded cash)?** `owner`, `sales_rep` — **not** `accountant`, even though `accountant` can view everything and confirm handovers. `PATCH /stock-exits/:id` has no input validation (inline type, no DTO), though it is behind the same `@Roles` guard as everything else so this is an authorization gap in depth, not in access.
- **RolesGuard mechanics** (`auth/roles.guard.ts`): plain allow-list, no implicit "owner bypasses everything" — every controller/route that should include `owner` does so explicitly, verified by direct reading of all controllers listed in §8.
- **Dev auth bypass** (`auth.guard.ts:14-30, 60-90`): double-gated (`NODE_ENV !== 'production'` AND `DEV_AUTH_BYPASS_ENABLED === 'true'`), auto-provisions the corresponding dev `User` row on first use. Not itself a money-flow risk, but worth noting it's the mechanism this whole audit's live testing used.

---

## 12. Dependency Map — what depends on receiver balances

- **Cash Handover page** — direct, primary consumer (`useAllBalances`, `useReceiverBalance`).
- **Dashboard** — indirect, via `useArSummary`/`useProfitLoss`, which read `Payment`/`Invoice`/`StockExit` tables that the receiver-crediting logic also writes to (not `UserAccount` itself).
- **Reports page** — same indirect relationship, plus directly renders the (currency-blind) AR `totalCollected` figure.
- **Warehouse Sales page** — writes into the ledger (Paths A/B in §3); its own "cash box" panel (fixed earlier this session) reads `Payment`/`StockExit`, not `UserAccount`, so it is independent of the receiver-balance system despite superficially looking related.
- **Settings page** — controls the population of receivers that every other page's picker draws from, and can destroy ledger history via receiver deletion (§5).
- **Client Detail / Fill Client Detail** — write `Payment` rows with a `receiverName` that never reaches the ledger; **do not** actually depend on or feed `UserAccount` despite having a receiver-shaped UI.
- **Expenses, Orders, Suppliers, Workers modules** — no references found (`grep` for `UserAccount`/`AccountEntry`/`creditAccount`/`debitAccount` outside the four files in §2 returns nothing in these modules).

---

## 13. Potential Risks (evidence-backed)

1. **Lost money (silent):** cash collected via anonymous warehouse sales (§1.3) or client/fill-client payments (§1.4/1.5) with a receiver explicitly selected is never added to that receiver's ledger balance. The UI gives every appearance of tracking it (a name is stored, shown in history) but Cash Handover will never show it as owed.
2. **Currency-unit mixing:** `UserAccount.balance`/`AccountEntry.amount` have no currency column; USD and LBP amounts are added as raw numbers (`walk-in-sales.service.ts:236` passes `received`, already converted to the *client's* currency, which may be LBP; `payments.service.ts:185` passes the raw `dto.amount` in `dto.currency`, unconverted). A receiver handling both currencies will show a balance that is a meaningless sum of two units.
3. **Stale balance after editing a stock exit's amount:** `updateExit()` never calls `creditAccount`/`debitAccount` (§5) — the ledger can silently diverge from what's displayed on the exit itself.
4. **Negative balances with no guard:** `debitAccount` never checks that `handedAmt ≤ current balance` (§5); a typo or a handover recorded against the wrong receiver can push a balance negative with no warning, error, or reconciliation prompt.
5. **Unvalidated cash-handover input:** no DTO/class-validator on `POST /cash-handovers` (§4/§8) — malformed numeric strings can reach `Decimal` columns via `parseFloat`-produced `NaN`.
6. **Expenses deducted during handover are not persisted:** (§4) — the itemized breakdown of what was subtracted from "collected" to reach "expected" exists only in React state and is discarded on submit/refresh.
7. **Client-trusted "expected" figure:** the backend never independently derives or checks `expectedAmt` against `UserAccount.balance` — the reconciliation's entire premise (comparing "what should be here" to "what was handed over") relies on a number the client computed and could, in principle, be wrong (per §4's date-scope inconsistency) or manipulated.
8. **Irreversible destructive delete:** deleting a receiver (`owner`-only, but no confirmation dialog in `Settings.tsx`) hard-deletes their entire `UserAccount` + `AccountEntry` history via cascade, with no check for `balance > 0` (§5).
9. **No correction path for handovers:** no update/delete route exists for `CashHandover` rows (§4/§8) — any mistake is permanent via the API.
10. **Dead/misleading safeguard code:** the `[ws]` payment filter in `CashHandover.tsx` (§4) describes a double-count protection that cannot function, since nothing ever writes the tag it checks for — a maintenance hazard for anyone who trusts the comment.
11. **Inconsistent cross-page numbers:** Dashboard vs. Reports show differently-computed "total collected" figures (§10) with no visible indication they're calculated differently.
12. **Partial-failure surface, mitigated but not zero:** every money-affecting service method found here (`WalkInSalesService.create`, `PaymentsService.create`, `StockExitsService.create`, `CashHandoversService.create`) correctly wraps its writes in a single `$transaction`, so a failure mid-write rolls back cleanly — this is a genuine strength, not a risk, and is called out here only for completeness of the "transaction boundaries" ask.

---

## 14. Final Architecture Summary

**Database architecture:** one real ledger (`UserAccount` 1:1 with `User`, `AccountEntry` 1:N off `UserAccount`), fed by exactly four call sites across three services, sitting alongside — but structurally disconnected from — `Client` accounts-receivable (computed on the fly, never stored), `Worker.totalEarned/totalPaid` (a second, separate cached-balance system), and the `CashHandover` audit trail (write-once, no update/delete).

**Balance architecture:** denormalized-and-cached (`UserAccount.balance`), backed by an append-only ledger (`AccountEntry`) that — *for the four call sites that exist* — is kept perfectly in sync by two shared helper functions (`creditAccount`/`debitAccount`). The system's actual weakness is not the ledger's internal math, which is sound; it's that most of the UI surfaces that *look* like they feed the ledger, don't.

**Receiver architecture:** `User` rows with `role = 'receiver'`, created/managed exclusively by `owner`s through Settings, surfaced through a shared-in-spirit-but-not-in-code hook (`useReceivers`) that four different pages each wire up slightly differently — one correctly (by ID), three incorrectly (by name only).

**Cash handover architecture:** a snapshot-style reconciliation tool that displays a real, ledger-backed balance when a receiver is selected, but computes "expected" from client-side numbers the server never re-validates, discards its own expense breakdown on submit, and produces permanent, uneditable historical rows once confirmed.

**Money flow:** correctly atomic and transactional at every write boundary found, currency-aware in the P&L report but not in the ledger itself or the AR summary, and — critically — only fully connected end-to-end (sale → receiver credit → handover debit) along one of the four paths a receiver can be selected from.

**API architecture:** consistent `@Roles`-based RBAC everywhere, with two endpoints (`PATCH /stock-exits/:id`, `POST /cash-handovers`) lacking `class-validator` DTOs and therefore any server-side input validation.

**Frontend architecture:** React Query hooks per resource, reasonably granular cache invalidation on mutation (with one gap: warehouse-sale creation doesn't invalidate cash-handover balance queries), and no shared "receiver picker" component — each page re-implements its own version, which is exactly how the by-name vs. by-ID inconsistency was able to happen independently in three places.

**Dependency graph:** Cash Handover is the only page that *reads* `UserAccount` directly; Warehouse Sales, Payments, and Stock Exits are the only services that *can write* to it; Client Detail and Fill Client Detail have receiver-shaped UI that never reaches it at all.

**Security model:** sound and consistent role gating throughout (`owner`/`accountant`/`sales_rep`/`worker` boundaries match the sensitivity of each action); the gaps found are in *validation* and *data-loss protection*, not in *authorization*.

**Risk assessment:** the highest-value fix, if this were ever addressed, would be closing the by-name/by-ID gap in §1.3–1.5, since every other finding in this report is either a downstream consequence of that gap (balances look "wrong" because most of the money never reached them) or an independent, smaller issue (currency mixing, missing validation, hard-delete cascade, discarded expense data).

---

*This document reflects the codebase as read on 2026-07-31. No files were modified to produce it.*
