import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { WarehouseStaffQueryDto } from '../../dto/warehouse-staff-query.dto';
import { WarehouseFacilityQueryDto } from '../../inventory/dto/warehouse-inventory-query.dto';

export const FRAUD_ALERT_STATUSES = ['UNRESOLVED', 'RESOLVED'] as const;

export class ScanBoxDto extends WarehouseFacilityQueryDto {
  @ApiProperty({ example: '3f1d6a52-8b1e-4c58-9a46-0d3a6f7b2c11', description: 'UID printed in the box QR code' })
  @IsUUID('all')
  uid: string;

  @ApiPropertyOptional({ description: 'Signature read from the box QR code, when it has one' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  signature?: string;
}

export class SsccParamDto {
  @ApiProperty({ example: '012345678901234567' })
  @Matches(/^[A-Za-z0-9-]{1,50}$/, { message: 'sscc must be 1-50 letters, digits or dashes' })
  sscc: string;
}

export class FraudAlertQueryDto extends WarehouseStaffQueryDto {
  @ApiPropertyOptional({ enum: FRAUD_ALERT_STATUSES })
  @IsOptional()
  @IsIn(FRAUD_ALERT_STATUSES)
  status?: (typeof FRAUD_ALERT_STATUSES)[number];
}

export class ResolveFraudAlertDto {
  @ApiProperty({ example: 'Compared with the delivery note; the label was misprinted' })
  @Matches(/\S/, { message: 'note must not be blank' })
  @MaxLength(500)
  note: string;
}
