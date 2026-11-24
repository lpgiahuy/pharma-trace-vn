import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { normalizeVietnamPhone } from "../../../../common/phone";

export class UserRegisterDto {
  @ApiProperty({
    example: "Customer",
    description: "Customer full legal name",
  })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({
    example: "0909123456",
    description: "Customer contact phone number",
  })
  @IsNotEmpty()
  @IsString()
  // Normalised first (+84 / spaces), then checked: a valid number is stored as 0 followed by 9 digits.
  @Transform(({ value }) => normalizeVietnamPhone(value) ?? value)
  @Matches(/^0\d{9}$/, { message: "Phone number must be a Vietnamese mobile number with 10 digits, e.g. 0909123456" })
  phone!: string;

  @ApiProperty({
    example: "customer@example.com",
    description: "Customer email address (required)",
  })
  @IsNotEmpty({ message: "Email address is required" })
  @IsEmail({}, { message: "Invalid email format" })
  email!: string;

  @ApiProperty({
    example: "password123",
    description: "Customer account password (minimum 6 characters)",
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({
    example: "123 Nguyen Hue, Ward 1, District 1, HCMC",
    description: "Primary shipping address (optional)",
  })
  @IsOptional()
  @IsString()
  address?: string;
}
