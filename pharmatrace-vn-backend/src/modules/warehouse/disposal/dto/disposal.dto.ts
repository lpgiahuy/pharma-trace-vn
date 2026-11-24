import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';
import { WarehouseStaffQueryDto } from '../../dto/warehouse-staff-query.dto';
import { WarehouseFacilityQueryDto } from '../../inventory/dto/warehouse-inventory-query.dto';

export const DISPOSAL_STATUSES = ['DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED'] as const;
export const DISPOSAL_SOURCES = ['EXPIRED', 'QUARANTINE', 'RECALL'] as const;

export class DisposalQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ enum: DISPOSAL_STATUSES })
  @IsOptional()
  @IsIn(DISPOSAL_STATUSES)
  status?: (typeof DISPOSAL_STATUSES)[number];
}

export class DisposalCandidateQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ enum: DISPOSAL_SOURCES })
  @IsOptional()
  @IsIn(DISPOSAL_SOURCES)
  source?: (typeof DISPOSAL_SOURCES)[number];
}

export class CreateDisposalDto extends WarehouseFacilityQueryDto {
  @ApiProperty({ example: 'DSP-20261120-7F3A2C', description: 'Client-generated code; resending the same code returns the existing disposal' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$/, { message: 'disposalCode must be 6-50 letters, digits, dashes or underscores' })
  disposalCode: string;

  @ApiProperty({ example: 'Expired stock found during the monthly check' })
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;

  @ApiProperty({ type: [String], description: 'UIDs of the scanned boxes' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  boxUids: string[];
}

export class DisposalReasonDto {
  @ApiProperty({ example: 'The boxes were scanned at the wrong warehouse' })
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;
}
