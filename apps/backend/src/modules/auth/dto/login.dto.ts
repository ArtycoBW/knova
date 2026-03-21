import { IsEmail, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Некорректный email" })
  email: string;

  @ApiProperty({ example: "Pass1word" })
  @IsString()
  @MinLength(5, { message: "Пароль должен содержать минимум 5 символов" })
  password: string;
}

export class LoginVerifyDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Некорректный email" })
  email: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @MinLength(5, { message: "Код должен содержать 5 символов" })
  code: string;
}
