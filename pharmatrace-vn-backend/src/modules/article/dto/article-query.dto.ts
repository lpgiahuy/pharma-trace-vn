import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ARTICLE_STATUSES = ['DRAFT', 'PENDING', 'PUBLISHED', 'HIDDEN'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export class ArticleQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @ApiPropertyOptional({ description: 'Search by title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ enum: ARTICLE_STATUSES, description: 'Admin list only' })
  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatus;
}

export class CommentQueryDto extends ArticleQueryDto {
  @ApiPropertyOptional({ description: 'Only comments of this article' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  articleId?: number;
}
