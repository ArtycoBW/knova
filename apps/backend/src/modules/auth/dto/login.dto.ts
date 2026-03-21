import { IsEmail, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "Pass1word" })
  @IsString()
  @MinLength(5)
  password: string;
}

export class LoginVerifyDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @MinLength(5)
  code: string;
}
