import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const RECEIPT_ATTACHMENT_KINDS = ['PHOTO', 'DELIVERY_NOTE', 'CO_CQ'] as const;
export type ReceiptAttachmentKind = (typeof RECEIPT_ATTACHMENT_KINDS)[number];

export class GoodsReceiptLineDto {
  @ApiProperty({ example: 31, description: 'Purchase order line being received' })
  @IsInt()
  @Min(1)
  poItemId: number;

  @ApiProperty({ example: 'LOT-2026-001', description: 'An existing batch of the same medicine, or a new batch to register' })
  @IsString()
  @Matches(/\S/, { message: 'batchNumber must not be blank' })
  @MaxLength(100)
  batchNumber: string;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'productionDate must be a date in YYYY-MM-DD format' })
  productionDate: string;

  @ApiProperty({ example: '2028-01-15' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'expiryDate must be a date in YYYY-MM-DD format' })
  expiryDate: string;

  @ApiPropertyOptional({ description: 'CO/CQ certificate reference stored on a new batch' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  certificateCoCq?: string;

  @ApiPropertyOptional({ type: [String], description: 'Scanned box UIDs accepted into sellable stock' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  boxUids?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Scanned SSCC cartons; every box in them is accepted' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  ssccCodes?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Scanned box UIDs rejected into quarantine' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  rejectedBoxUids?: string[];

  @ApiPropertyOptional({ example: 'Crushed during delivery', description: 'Required when boxes are rejected' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  rejectReason?: string;
}

export class GoodsReceiptDto {
  @ApiProperty({ example: 'GR-20261118-7F3A2C', description: 'Client-generated code; resending the same code returns the existing receipt' })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,49}$/, { message: 'receiptCode must be 6-50 letters, digits, dashes or underscores' })
  receiptCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ type: [GoodsReceiptLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines: GoodsReceiptLineDto[];
}

export class ClosePurchaseOrderDto {
  @ApiProperty({ example: 'Supplier cannot deliver the remaining quantity' })
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  reason: string;
}

export class ReceiptAttachmentDto {
  @ApiProperty({ enum: RECEIPT_ATTACHMENT_KINDS })
  @IsIn(RECEIPT_ATTACHMENT_KINDS)
  kind: ReceiptAttachmentKind;

  @ApiPropertyOptional({ description: 'Batch of this receipt the CO/CQ belongs to' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  batchId?: number;
}
