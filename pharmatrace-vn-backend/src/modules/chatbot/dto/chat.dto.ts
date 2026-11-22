import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ChatTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1500) content: string;
}

export class AskChatbotDto {
  @ApiProperty({ example: 'I have had a runny nose, stuffy nose and a mild fever since yesterday. What should I take?' })
  @IsString() @MinLength(2) @MaxLength(600) message: string;

  @ApiPropertyOptional({ type: [ChatTurnDto], description: 'Previous turns, oldest first (the server keeps only the latest 8)' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}
