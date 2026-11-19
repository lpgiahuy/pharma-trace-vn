import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { PackOrderDto } from '../../../order/dto/pack-order.dto';

export class CreatePackageDto {
  @ApiProperty({ example: 'PKG-20261119-7F3A2C', description: 'Client-generated code; resending the same code returns the existing package' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$/, { message: 'packageCode must be 6-50 letters, digits, dashes or underscores' })
  packageCode: string;

  @ApiProperty({ type: [String], description: 'Scanned box UIDs' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  boxUids: string[];

  @ApiPropertyOptional({ example: 850 })
  @IsOptional()
  @IsInt()
  @Min(1)
  weightG?: number;

  @ApiPropertyOptional({ example: '30x20x15 cm' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dimensions?: string;
}

export class CompletePackingDto extends PickType(PackOrderDto, ['courierName', 'shippingNote'] as const) {}

export class VoidPackageDto {
  @ApiProperty({ example: 'Wrong box packed' })
  @Matches(/\S/, { message: 'reason is required' })
  @MaxLength(500)
  reason: string;
}
