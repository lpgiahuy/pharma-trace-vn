import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class VerifyBoxDto {
  @ApiProperty() @IsUUID() uid: string;

  @ApiProperty({ description: 'Secret code printed with the QR code' })
  @IsString() @MinLength(1) @MaxLength(128) code: string;

  @ApiPropertyOptional({ description: 'Random id the browser keeps, used to tell whether a code is entered from several devices' })
  @IsOptional() @IsUUID() deviceId?: string;
}

export class ScanBoxDto {
  @ApiProperty() @IsUUID() uid: string;

  @ApiPropertyOptional({ example: 21.0285 }) @IsOptional() @IsLatitude() latitude?: number;

  @ApiPropertyOptional({ example: 105.8542 }) @IsOptional() @IsLongitude() longitude?: number;
}
