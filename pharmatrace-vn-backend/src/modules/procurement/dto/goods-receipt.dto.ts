import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const RECEIPT_ATTACHMENT_KINDS = ['PHOTO', 'DELIVERY_NOTE', 'CO_CQ'] as const;
export type ReceiptAttachmentKind = (typeof RECEIPT_ATTACHMENT_KINDS)[number];

export class GoodsReceiptLineDto {
  @ApiProperty({ example: 31, description: 'Purchase order line being received' })
  @IsInt()
  @Min(1)
  poItemId: number;

  @ApiPropertyOptional({ description: 'Receive every box the factory shipped on this line except the rejected and missing ones; batch and dates then come from the boxes' })
  @IsOptional()
  @IsBoolean()
  shipped?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'With shipped: box UIDs that did not arrive; they stay reserved until the order is closed' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  missingBoxUids?: string[];

  @ApiPropertyOptional({ example: 'LOT-2026-001', description: 'An existing batch of the same medicine, or a new batch to register; not needed with shipped' })
  @ValidateIf((line: GoodsReceiptLineDto) => !line.shipped)
  @IsString()
  @Matches(/\S/, { message: 'batchNumber must not be blank' })
  @MaxLength(100)
  batchNumber: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @ValidateIf((line: GoodsReceiptLineDto) => !line.shipped)
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'productionDate must be a date in YYYY-MM-DD format' })
  productionDate: string;

  @ApiPropertyOptional({ example: '2028-01-15' })
  @ValidateIf((line: GoodsReceiptLineDto) => !line.shipped)
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

  @ApiPropertyOptional({ example: 80, description: 'Outside manufacturer only: boxes counted in good condition; the system issues their UIDs. Use instead of boxUids' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  acceptedQuantity?: number;

  @ApiPropertyOptional({ example: 2, description: 'Outside manufacturer only: boxes counted as damaged (quarantined); the system issues their UIDs' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  rejectedQuantity?: number;

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
