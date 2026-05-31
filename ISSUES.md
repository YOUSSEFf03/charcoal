# Known Issues

## Packing Module

### Issue #8 — Incorrect stock deduction and waste handling with multiple charcoal types ✓ Fixed

**Page:** Packing → Add Packing Entry

**Problem:** Incorrect stock deduction and waste handling when packing uses multiple charcoal types.

**Example:**

| Input | Value |
|-------|-------|
| Type A used | 600 kg |
| Type B used | 410 kg |
| Total charcoal input | 1010 kg |
| Output | 100 bags × 10 kg = 1000 kg |
| Waste | 10 kg |

**Current Result:**

- The system deducts the entire 1000 kg output from only one charcoal type instead of distributing deductions according to the actual quantities used.
- The 10 kg waste/loss is not deducted from inventory.

**Expected:**

- Stock should be deducted from each charcoal lot/type based on the actual weight entered for that lot.
  - Type A: deduct **600 kg**
  - Type B: deduct **410 kg**
- The total inventory reduction should equal the total charcoal input (1010 kg).
- Waste/loss (10 kg) must be accounted for and removed from available stock.
- Inventory calculations must satisfy:
  - **Input Stock Consumed = Output Produced + Waste/Loss**
  - **1010 kg = 1000 kg + 10 kg**
