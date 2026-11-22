import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';

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

export class RevenueSeriesDto extends ReportRangeDto {
  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'day', description: 'day allows up to 366 days, month up to 36 months' })
  @IsOptional()
  @IsIn(['day', 'month'])
  granularity?: 'day' | 'month';
}
