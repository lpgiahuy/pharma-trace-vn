import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class CommentStatusDto {
  @ApiProperty({ enum: ['VISIBLE', 'HIDDEN'] })
  @IsIn(['VISIBLE', 'HIDDEN'])
  status: 'VISIBLE' | 'HIDDEN';
}
