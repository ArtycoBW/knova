import { IsEmail, IsString, MinLength, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "Pass1word" })
  @IsString()
  @MinLength(5)
  @Matches(/[A-Z]/, { message: "Пароль должен содержать заглавную букву" })
  @Matches(/[0-9]/, { message: "Пароль должен содержать цифру" })
  password: string;
}

export class VerifyCodeDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @MinLength(5)
  code: string;
}

export class RegisterProfileDto {
  @ApiProperty({ example: "Иван" })
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiProperty({ example: "Иванов" })
  @IsString()
  @MinLength(1)
  lastName: string;

  @ApiProperty({ example: "Центр-Инвест", required: false })
  @IsString()
  organization?: string;

  @ApiProperty({ example: "STUDENT", enum: ["STUDENT", "SCIENTIST", "OFFICIAL", "OTHER"] })
  @IsString()
  role?: string;
}
