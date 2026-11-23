import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ARTICLE_STATUSES, type ArticleStatus } from './article-query.dto';

export class SaveArticleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @ApiProperty({ description: 'Rich text as HTML' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImagePublicId?: string;

  @ApiPropertyOptional({ enum: ARTICLE_STATUSES, default: 'DRAFT' })
  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatus;
}

export class ReviewArticleDto {
  @ApiProperty({ enum: ['PUBLISHED', 'HIDDEN', 'DRAFT'] })
  @IsIn(['PUBLISHED', 'HIDDEN', 'DRAFT'])
  status: 'PUBLISHED' | 'HIDDEN' | 'DRAFT';

  @ApiPropertyOptional({ description: 'Reason shown to the author when sent back to draft' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

export class SaveCategoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
