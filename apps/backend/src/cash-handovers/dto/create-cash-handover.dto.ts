import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Itemized amount already deducted from collected cash before handover
 * (e.g. gas, parking) — persisted as a CashHandoverExpense row.
 *
 * Forensic audit (2026-08-31), "Expenses + Cash Handover expense selection
 * redesign": a free-text `description` previously let the same real-world
 * expense be logged under any spelling ("fuel"/"Fuel"/"benzin"/"gaz"),
 * making it impossible to reliably group/report by category. This now
 * requires an existing ExpenseCategory (selected from a dropdown, or
 * created via POST /expense-categories' find-or-create) — CashHandoversService
 * .create() resolves `categoryId` to the category's name and stores THAT as
 * `CashHandoverExpense.description`, so every existing reader of that column
 * keeps working unchanged.
 */
export class CashHandoverExpenseDto {
  @ApiProperty({ description: 'UUID of an existing ExpenseCategory (see GET/POST /expense-categories)' })
  @IsUUID('all') categoryId: string;

  @ApiProperty({ description: 'Expense amount (decimal string)', example: '10.00' })
  @IsNumberString() @IsNotEmpty() amount: string;
}

/**
 * POST /cash-handovers — was previously a plain inline `@Body()` object type,
 * which NestJS's global ValidationPipe silently skips (it only validates
 * decorated classes), so this endpoint received completely unvalidated input
 * (no UUID/date/numeric-format checks, no whitelist stripping). This class
 * restores the same protection every other write endpoint in this codebase has.
 */
export class CreateCashHandoverDto {
  @ApiProperty({ description: 'Handover date (ISO 8601)', example: '2024-01-15' })
  @IsDateString() @IsNotEmpty() date: string;

  @ApiProperty({ description: 'UUID of the user handing over cash' })
  @IsUUID('all') receiverId: string;

  @ApiProperty({ description: 'Name of the person handing over cash (legacy fallback, set automatically from receiverId)', required: false })
  @IsOptional() @IsString() receiverName?: string;

  @ApiProperty({ description: 'Amount expected to be handed over (decimal string)', example: '500.00' })
  @IsNumberString() @IsNotEmpty() expectedAmt: string;

  @ApiProperty({ description: 'Amount actually handed over (decimal string)', example: '480.00' })
  @IsNumberString() @IsNotEmpty() handedAmt: string;

  @ApiProperty({ description: 'Optional notes', required: false })
  @IsOptional() @IsString() notes?: string | null;

  @ApiProperty({ description: 'Itemized amounts already deducted from the collected cash before handover', type: [CashHandoverExpenseDto], required: false })
  @IsOptional()
  @IsArray() @ValidateNested({ each: true }) @Type(() => CashHandoverExpenseDto)
  expenses?: CashHandoverExpenseDto[];
}
