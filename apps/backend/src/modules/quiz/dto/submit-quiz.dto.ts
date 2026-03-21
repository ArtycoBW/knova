import { IsArray, IsInt, Min } from "class-validator";

export class SubmitQuizDto {
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  answers!: number[];
}
