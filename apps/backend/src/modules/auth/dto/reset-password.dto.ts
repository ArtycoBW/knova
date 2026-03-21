import { IsEmail, IsString, MinLength, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ResetPasswordDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Некорректный email" })
  email: string;
}

export class ResetPasswordConfirmDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { message: "Некорректный email" })
  email: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @MinLength(5, { message: "Код должен содержать 5 символов" })
  code: string;

  @ApiProperty({ example: "NewPass1word" })
  @IsString()
  @MinLength(5, { message: "Пароль должен содержать минимум 5 символов" })
  @Matches(/[A-Z]/, { message: "Пароль должен содержать заглавную букву" })
  @Matches(/[0-9]/, { message: "Пароль должен содержать цифру" })
  newPassword: string;
}
