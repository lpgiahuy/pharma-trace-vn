import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class WarehouseStaffQueryDto {
  @ApiPropertyOptional({ example: 3, description: 'Warehouse to list. Only SUPER_ADMIN may set it; others always get their own warehouse.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  facilityId?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
