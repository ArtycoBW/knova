import { IsString, IsOptional, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateProfileDto {
  @ApiProperty({ example: "Иван", required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @ApiProperty({ example: "Иванов", required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @ApiProperty({ example: "Центр-Инвест", required: false })
  @IsOptional()
  @IsString()
  organization?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({ enum: ["STUDENT", "SCIENTIST", "OFFICIAL", "OTHER"], required: false })
  @IsOptional()
  @IsString()
  role?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(5)
  newPassword: string;
}
