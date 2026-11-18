import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { WarehouseStaffQueryDto } from '../../warehouse/dto/warehouse-staff-query.dto';

export const PURCHASE_ORDER_STATUSES = ['PENDING', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;

export class PurchaseOrderLineDto {
  @ApiProperty({ example: 12, description: 'Packaging variant to order' })
  @IsInt()
  @Min(1)
  variantId: number;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  @ApiProperty({ example: 25000.5, description: 'Price per unit, at most 2 decimals' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999)
  unitPrice: number;
}

/** Body of create and edit. The total is always computed from the lines on the server. */
export class PurchaseOrderDto {
  @ApiPropertyOptional({ description: 'Receiving warehouse. Required for SUPER_ADMIN; managers always get their own warehouse.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  facilityId?: number;

  @ApiPropertyOptional({ description: 'Supplier that is a FACTORY facility. Send this or supplierManufacturerId.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierFacilityId?: number;

  @ApiPropertyOptional({ description: 'Supplier that is an external manufacturer. Send this or supplierFacilityId.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  supplierManufacturerId?: number;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsDateString()
  expectedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

export class CancelPurchaseOrderDto {
  @ApiProperty({ example: 'Supplier discontinued the product' })
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;
}

export class PurchaseOrderQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_ORDER_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_ORDER_STATUSES)
  status?: (typeof PURCHASE_ORDER_STATUSES)[number];
}

export class PurchaseOrderOptionsQueryDto {
  @ApiPropertyOptional({ description: 'Medicine name contains; at most 20 variants are returned' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
