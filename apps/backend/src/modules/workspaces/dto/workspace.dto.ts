import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateWorkspaceDto {
  @ApiProperty({ example: "Диплом по ИИ" })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ example: "Материалы по теме машинного обучения" })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateWorkspaceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class CompareDocumentsDto {
  @ApiProperty({
    type: [String],
    example: ["cmn-doc-1", "cmn-doc-2"],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  documentIds: string[];
}
