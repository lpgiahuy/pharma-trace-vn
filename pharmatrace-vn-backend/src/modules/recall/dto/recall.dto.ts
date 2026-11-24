import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export const RECALL_SEVERITIES = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;

export class CreateRecallDto {
  @ApiProperty({ example: 'RCL-20261120-01', description: 'Client-generated code; resending it with the same batches returns the existing recall' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{5,29}$/, { message: 'recallCode must be 6-30 letters, digits, dashes or underscores' })
  recallCode: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) reason: string;

  @ApiProperty({ enum: RECALL_SEVERITIES }) @IsIn(RECALL_SEVERITIES) severity: (typeof RECALL_SEVERITIES)[number];

  @ApiPropertyOptional({ description: 'Link to the recall decision document' })
  @IsOptional() @IsString() @MaxLength(500) documentUrl?: string;

  @ApiProperty({ type: [Number] })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsInt({ each: true }) @Min(1, { each: true })
  batchIds: number[];
}

export class CollectRecallDto {
  @ApiProperty({ example: 1, description: 'Factory, central or branch warehouse that receives the recalled stock' })
  @IsInt() @Min(1) destinationFacilityId: number;
}

export class CollectFromFacilityDto {
  @ApiProperty({ example: 2045, description: 'The facility that started the recall (see GET :id/collection-destination); no other facility is accepted' })
  @IsInt() @Min(1) toFacilityId: number;

  @ApiPropertyOptional({ description: 'Note copied to the collection transfer' })
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CloseRecallDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) note: string;
}
