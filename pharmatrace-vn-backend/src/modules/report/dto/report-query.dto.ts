import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ReportRangeDto {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'First day (Vietnam time). Defaults to 29 days before `to`.' })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Last day, inclusive (Vietnam time). Defaults to today.' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ example: 3, description: 'Facility to report on. Ignored for STORE_MANAGER, who always gets their own facility.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  facilityId?: number;
}

export class StockAlertQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'Facility to report on. Ignored for STORE_MANAGER, who always gets their own facility.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  facilityId?: number;
}

export class ExpiryAlertQueryDto extends StockAlertQueryDto {
  @ApiPropertyOptional({ example: 180, default: 180, description: 'Lists batches expiring within this many days, plus every expired batch' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  withinDays?: number;
}

export class StockThresholdDto {
  @ApiProperty({ example: 20, description: 'Minimum available quantity before the item shows as low stock' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class InventoryThresholdDto {
  @ApiProperty({ example: 20, nullable: true, description: 'Minimum available quantity; null makes the inventory use the system default' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  quantity!: number | null;
}

export class RevenueSeriesDto extends ReportRangeDto {
  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'day', description: 'day allows up to 366 days, month up to 36 months' })
  @IsOptional()
  @IsIn(['day', 'month'])
  granularity?: 'day' | 'month';
}

export class AgingQueryDto {
  @ApiPropertyOptional({ example: '2026-11-30', description: 'Age the debts as of this day (Vietnam time). Defaults to today.' })
  @IsOptional()
  @Matches(DAY, { message: 'asOf must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  asOf?: string;
}

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET'] as const;
const CASHBOOK_TYPES = ['INCOME', 'EXPENSE'] as const;

export class CashbookExportQueryDto extends OmitType(ReportRangeDto, ['facilityId'] as const) {
  @ApiPropertyOptional({ enum: PAYMENT_METHODS, description: 'Also limits the balances and daily totals' })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ enum: CASHBOOK_TYPES, description: 'Limits the entries only, not the balances' })
  @IsOptional()
  @IsIn(CASHBOOK_TYPES)
  type?: (typeof CASHBOOK_TYPES)[number];

  @ApiPropertyOptional({ example: 'COD', description: 'Cashbook category as returned in `categories`. Limits the entries only, not the balances' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;
}

export class CashbookQueryDto extends CashbookExportQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
