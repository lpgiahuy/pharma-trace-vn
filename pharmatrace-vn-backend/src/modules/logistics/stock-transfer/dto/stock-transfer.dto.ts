import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class StockTransferLineDto {
  @ApiProperty({ example: 12 }) @IsInt() @Min(1) variantId: number;
  @ApiProperty({ example: 20 }) @IsInt() @Min(1) @Max(100000) quantity: number;
}

export class CreateStockTransferRequestDto {
  @ApiProperty({ example: 'STQ-20261119-7F3A2C', description: 'Client-generated code; resending the same code returns the existing request' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,39}$/, { message: 'requestCode must be 6-40 letters, digits, dashes or underscores' })
  requestCode: string;

  @ApiProperty({ example: 3, description: 'Facility that sends the stock' })
  @IsInt() @Min(1)
  fromFacilityId: number;

  @ApiProperty({ type: [StockTransferLineDto] })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => StockTransferLineDto)
  lines: StockTransferLineDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SendFactoryTransferDto {
  @ApiProperty({ example: 'FTS-20261119-7F3A2C', description: 'Client-generated code; resending the same code returns the existing transfer' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,39}$/, { message: 'requestCode must be 6-40 letters, digits, dashes or underscores' })
  requestCode: string;
  @ApiProperty({ example: 3, description: 'Warehouse that receives the stock' })
  @IsInt() @Min(1)
  toFacilityId: number;
  @ApiProperty({ type: [StockTransferLineDto] })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => StockTransferLineDto)
  lines: StockTransferLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class StockTransferDecisionDto {
  @ApiPropertyOptional({ description: 'Required to reject or cancel' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SourceStockQueryDto {
  @ApiProperty({ example: 3, description: 'Facility whose free stock to list' })
  @Type(() => Number) @IsInt() @Min(1)
  facilityId: number;
}
