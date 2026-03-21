import { IsEnum } from "class-validator";

export enum PodcastTone {
  SCIENTIFIC = "scientific",
  POPULAR = "popular",
}

export enum PodcastLength {
  SHORT = "short",
  MEDIUM = "medium",
  LONG = "long",
}

export class GeneratePodcastDto {
  @IsEnum(PodcastTone)
  tone!: PodcastTone;

  @IsEnum(PodcastLength)
  length!: PodcastLength;
}
