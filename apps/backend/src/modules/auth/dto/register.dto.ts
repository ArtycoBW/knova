import { IsEmail, IsString, IsOptional, MinLength, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Некорректный email" })
  email: string;

  @ApiProperty({ example: "Pass1word" })
  @IsString({ message: "Пароль должен быть строкой" })
  @MinLength(5, { message: "Пароль должен содержать минимум 5 символов" })
  @Matches(/[A-Z]/, { message: "Пароль должен содержать заглавную букву" })
  @Matches(/[0-9]/, { message: "Пароль должен содержать цифру" })
  password: string;
}

export class VerifyCodeDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Некорректный email" })
  email: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @MinLength(5, { message: "Код должен содержать 5 символов" })
  code: string;
}

export class RegisterProfileDto {
  @ApiProperty({ example: "clxyz123" })
  @IsString()
  userId: string;

  @ApiProperty({ example: "Иван" })
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiProperty({ example: "Иванов" })
  @IsString()
  @MinLength(1)
  lastName: string;

  @ApiProperty({ example: "Центр-Инвест", required: false })
  @IsOptional()
  @IsString()
  organization?: string;

  @ApiProperty({ example: "STUDENT", enum: ["STUDENT", "SCIENTIST", "OFFICIAL", "OTHER"] })
  @IsOptional()
  @IsString()
  role?: string;
}
