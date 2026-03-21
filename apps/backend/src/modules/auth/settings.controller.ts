import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { EmbeddingService } from "../llm/embedding.service";
import { LlmProvider, LlmService } from "../llm/llm.service";
import { SttService } from "../llm/stt.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

class UpdateLlmDto {
  @ApiProperty({ enum: ["centrinvest", "gemini", "ollama"] })
  @IsIn(["centrinvest", "gemini", "ollama"])
  provider: LlmProvider;
}

@ApiTags("Settings")
@Controller("settings")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
    private readonly stt: SttService,
  ) {}

  @Get("llm")
  @ApiOperation({ summary: "Текущий AI-провайдер" })
  getLlm() {
    return this.llm.getProviderInfo();
  }

  @Put("llm")
  @ApiOperation({ summary: "Сменить AI-провайдер" })
  setLlm(@Body() dto: UpdateLlmDto) {
    this.llm.switchProvider(dto.provider);
    this.embedding.switchProvider(dto.provider);
    this.stt.switchProvider(dto.provider);
    return this.llm.getProviderInfo();
  }

  @Get("llm/providers")
  @ApiOperation({ summary: "Список доступных провайдеров" })
  getProviders() {
    return [
      {
        id: "centrinvest",
        name: "Центр-Инвест",
        description: "Внутренняя инфраструктура хакатона",
        sttAvailable: true,
      },
      {
        id: "gemini",
        name: "Gemini",
        description: "Google Gemini API",
        sttAvailable: false,
      },
      {
        id: "ollama",
        name: "Ollama",
        description: "Локальный LLM (офлайн)",
        sttAvailable: false,
      },
    ];
  }
}
