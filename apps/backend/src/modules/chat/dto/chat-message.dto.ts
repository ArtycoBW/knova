import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class SendChatMessageDto {
  @ApiProperty({ example: "Сделай краткое резюме ключевых идей документа" })
  @IsString()
  @MinLength(1)
  content: string;
}
