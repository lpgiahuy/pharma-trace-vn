import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { PAYMENT_METHODS } from './report-query.dto';

export class RecordSupplierPaymentDto {
  @ApiProperty({ example: 1250000, description: 'VND, at most 2 decimals, not above the remaining balance' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  amount!: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiProperty({ example: 'FT26123456789', description: 'Bank or receipt reference; unique per payment method' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  reference!: string;
}
