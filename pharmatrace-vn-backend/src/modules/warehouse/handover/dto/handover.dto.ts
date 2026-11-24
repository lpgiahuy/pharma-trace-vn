import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { WarehouseFacilityQueryDto } from '../../inventory/dto/warehouse-inventory-query.dto';

export class CreateHandoverDto extends WarehouseFacilityQueryDto {
  @ApiProperty({ example: 'HOV-20261119-7F3A2C', description: 'Client-generated code; resending the same code returns the existing handover' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$/, { message: 'handoverCode must be 6-50 letters, digits, dashes or underscores' })
  handoverCode: string;

  @ApiProperty({ example: 'GHN' })
  @Matches(/\S/, { message: 'courierName is required' })
  @MaxLength(100)
  courierName: string;

  @ApiProperty({ type: [String], description: 'Scanned package codes' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  packageCodes: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) driverName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) driverPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) vehiclePlate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
