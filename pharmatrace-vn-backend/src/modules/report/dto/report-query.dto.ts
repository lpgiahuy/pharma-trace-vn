import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator';

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
