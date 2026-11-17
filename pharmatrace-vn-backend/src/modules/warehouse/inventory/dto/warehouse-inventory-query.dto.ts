import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { WarehouseStaffQueryDto } from '../../dto/warehouse-staff-query.dto';

export class WarehouseFacilityQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'Warehouse to read. Only SUPER_ADMIN may set it; others always get their own warehouse.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  facilityId?: number;
}

export class WarehouseInventoryQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ description: 'Medicine name contains' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;
}

export class WarehouseInventoryLogQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ example: 'QUARANTINE_IN', description: 'Transaction type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @ApiPropertyOptional({ description: 'Reference code contains' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Inclusive end date' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class WarehouseBatchQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ description: 'Batch number or medicine name contains' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: 30, description: 'Only batches expiring within this many days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}
