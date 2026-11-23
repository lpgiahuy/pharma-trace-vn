import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class FactoryFacilityQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'Factory to read. Only SUPER_ADMIN may set it; others always get their own factory.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  facilityId?: number;
}

export class CreateFactoryBatchDto extends FactoryFacilityQueryDto {
  @ApiProperty({ example: 12, description: 'Product packaging of the batch; its medicine becomes the batch medicine' })
  @IsInt()
  @Min(1)
  variantId: number;

  @ApiProperty({ example: 'LOT-2026-001' })
  @IsString()
  @Matches(/\S/, { message: 'batchNumber must not be blank' })
  @MaxLength(100)
  batchNumber: string;

  @ApiProperty({ example: '2026-11-01' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'productionDate must be a date in YYYY-MM-DD format' })
  productionDate: string;

  @ApiProperty({ example: '2028-11-01' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'expiryDate must be a date in YYYY-MM-DD format' })
  expiryDate: string;

  @ApiProperty({ example: 1000, description: 'Total boxes produced' })
  @IsInt()
  @Min(1)
  boxCount: number;

  @ApiProperty({ example: 24, description: 'Boxes per SSCC carton; the last carton holds the remainder' })
  @IsInt()
  @Min(1)
  boxesPerCarton: number;

  @ApiPropertyOptional({ description: 'CO/CQ certificate reference' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  certificateCoCq?: string;
}

export class VoidFactoryBatchDto {
  @ApiProperty({ example: 'Registered with the wrong box count', description: 'Why the batch is voided; kept in the batch status history' })
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;
}
