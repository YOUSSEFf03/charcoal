/**
 * One-time historical correction for the Cash Handover expense-settlement
 * bug (forensic audit, 2026-08-30). See
 * src/cash-handovers/cash-handover-correction.service.ts for the full
 * algorithm and rationale.
 *
 * Usage (from apps/backend):
 *   npx ts-node scripts/cash-handover-correction.ts --dry-run   (default; no writes)
 *   npx ts-node scripts/cash-handover-correction.ts --apply     (writes; requires --apply explicitly)
 *
 * --apply re-verifies every candidate against the live database inside a
 * transaction (with an advisory lock keyed to each handover's own
 * correction id) before writing anything, and is idempotent — running it
 * again after a successful apply reports "already_applied" for each
 * previously-corrected handover and writes nothing further.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CashHandoverCorrectionService } from '../src/cash-handovers/cash-handover-correction.service';

function fmtUsd(s: string): string {
  return `$${parseFloat(s).toFixed(2)}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const service = app.get(CashHandoverCorrectionService);

  const { candidates, actionable } = await service.dryRun();

  // eslint-disable-next-line no-console
  console.log('\n=== Cash Handover Correction — Dry Run ===\n');
  // eslint-disable-next-line no-console
  console.log('Receiver'.padEnd(20), 'Handover'.padEnd(38), 'Expense'.padEnd(10), 'Already settled'.padEnd(16), 'Remaining correction');
  for (const c of candidates) {
    // eslint-disable-next-line no-console
    console.log(
      c.receiverName.padEnd(20),
      c.handoverId.padEnd(38),
      fmtUsd(c.expenseTotal).padEnd(10),
      fmtUsd(c.alreadySettled).padEnd(16),
      fmtUsd(c.remainingCorrection),
    );
  }
  // eslint-disable-next-line no-console
  console.log(`\n${candidates.length} historical handover(s) with expenses audited. ${actionable.length} require correction today.\n`);

  if (!apply) {
    // eslint-disable-next-line no-console
    console.log('Dry run only — zero database writes performed. Re-run with --apply to write the correction(s) above.\n');
    await app.close();
    return;
  }

  if (actionable.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Nothing to apply.\n');
    await app.close();
    return;
  }

  // eslint-disable-next-line no-console
  console.log('=== APPLYING ===\n');
  const results = await service.apply(actionable);
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.status.toUpperCase()} — handover ${r.handoverId}, receiver ${r.receiverId}, amount ${fmtUsd(r.amount)}${r.detail ? ` (${r.detail})` : ''}`);
  }

  await app.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
