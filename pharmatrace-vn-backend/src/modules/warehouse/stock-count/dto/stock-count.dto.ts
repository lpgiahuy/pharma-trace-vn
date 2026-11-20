import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { WarehouseStaffQueryDto } from '../../dto/warehouse-staff-query.dto';
import { WarehouseFacilityQueryDto } from '../../inventory/dto/warehouse-inventory-query.dto';

export const STOCK_COUNT_STATUSES = ['OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED'] as const;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$/;

export class OpenStockCountDto extends WarehouseFacilityQueryDto {
  @ApiProperty({ example: 'SC-20261120-7F3A2C', description: 'Client-generated code; resending the same code returns the existing count' })
  @Matches(CODE, { message: 'countCode must be 6-50 letters, digits, dashes or underscores' })
  countCode: string;

  @ApiPropertyOptional({ description: 'Count one medicine. Send neither medicineId nor batchId to count the whole warehouse.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  medicineId?: number;

  @ApiPropertyOptional({ description: 'Count one batch' })
  @IsOptional()
  @IsInt()
  @Min(1)
  batchId?: number;
}

export class CountedBatchDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  batchId: number;

  @ApiProperty({ example: 48 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  countedQuantity: number;
}

export class SaveStockCountLinesDto {
  @ApiProperty({ type: [CountedBatchDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CountedBatchDto)
  lines: CountedBatchDto[];
}

export class StockCountReasonDto {
  @ApiProperty({ example: 'Count was entered for the wrong shelf' })
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;
}

export class StockAdjustmentDto extends WarehouseFacilityQueryDto {
  @ApiProperty({ example: 'ADJ-20261120-7F3A2C', description: 'Client-generated code; resending the same code returns the existing adjustment' })
  @Matches(CODE, { message: 'adjustmentCode must be 6-50 letters, digits, dashes or underscores' })
  adjustmentCode: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  batchId: number;

  @ApiProperty({ example: -2, description: 'Units to add (positive) or remove (negative); not zero' })
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  quantityChange: number;

  @ApiProperty({ example: 'Two boxes crushed by a pallet' })
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;
}

export class StockCountQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ enum: STOCK_COUNT_STATUSES })
  @IsOptional()
  @IsIn(STOCK_COUNT_STATUSES)
  status?: (typeof STOCK_COUNT_STATUSES)[number];
}
