import { IsEmail, IsString, MinLength, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ResetPasswordDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;
}

export class ResetPasswordConfirmDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @MinLength(5)
  code: string;

  @ApiProperty({ example: "NewPass1word" })
  @IsString()
  @MinLength(5)
  @Matches(/[A-Z]/, { message: "Пароль должен содержать заглавную букву" })
  @Matches(/[0-9]/, { message: "Пароль должен содержать цифру" })
  newPassword: string;
}
