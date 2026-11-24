import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class DispatchManifestLineDto {
  @IsInt() @Min(1) variantId: number;
  @IsInt() @Min(1) quantity: number;
  @ApiPropertyOptional({ description: 'Box UIDs scanned one by one' })
  @IsOptional() @IsArray() @IsString({ each: true }) boxUids?: string[];
  @ApiPropertyOptional({ description: 'SSCC carton codes of this variant; every box of each carton is added to the manifest line' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(40, { each: true }) cartonCodes?: string[];
}

export class DispatchTransferDto {
  @ApiProperty({ enum: ['INTERNAL', 'THIRD_PARTY'] })
  @IsIn(['INTERNAL', 'THIRD_PARTY']) transportMode: 'INTERNAL' | 'THIRD_PARTY';
  @ApiPropertyOptional({ description: 'Active employee at the source facility, required for INTERNAL' })
  @IsOptional() @IsInt() @Min(1) transportEmployeeId?: number;
  @ApiPropertyOptional({ description: 'Required for THIRD_PARTY' })
  @IsOptional() @IsString() @MaxLength(100) courierName?: string;
  @ApiPropertyOptional({ description: 'Actual carrier tracking number, required for THIRD_PARTY' })
  @IsOptional() @IsString() @MaxLength(100) trackingCode?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DispatchManifestLineDto)
  manifest: DispatchManifestLineDto[];
}
