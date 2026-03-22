import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
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

interface ProviderStatus {
  available: boolean;
  reason: string | null;
}

@ApiTags("Settings")
@Controller("settings")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(
    private readonly config: ConfigService,
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
  @ApiOperation({ summary: "Сменить AI-провайдера" })
  async setLlm(@Body() dto: UpdateLlmDto) {
    const status = await this.getProviderStatus(dto.provider);

    if (!status.available) {
      throw new BadRequestException(status.reason);
    }

    this.llm.switchProvider(dto.provider);
    this.embedding.switchProvider(dto.provider);
    this.stt.switchProvider(dto.provider);
    return this.llm.getProviderInfo();
  }

  @Get("llm/providers")
  @ApiOperation({ summary: "Список доступных провайдеров" })
  async getProviders() {
    const centrinvestStatus = await this.getProviderStatus("centrinvest");
    const geminiStatus = await this.getProviderStatus("gemini");
    const ollamaStatus = await this.getProviderStatus("ollama");

    return [
      {
        id: "centrinvest",
        name: "Центр-Инвест",
        description: "Внутренняя инфраструктура хакатона",
        sttAvailable: true,
        available: centrinvestStatus.available,
        reason: centrinvestStatus.reason,
      },
      {
        id: "gemini",
        name: "Gemini",
        description: "Google Gemini API",
        sttAvailable: false,
        available: geminiStatus.available,
        reason: geminiStatus.reason,
      },
      {
        id: "ollama",
        name: "Ollama",
        description: "Локальный LLM для офлайн-режима",
        sttAvailable: false,
        available: ollamaStatus.available,
        reason: ollamaStatus.reason,
      },
    ];
  }

  private async getProviderStatus(provider: LlmProvider): Promise<ProviderStatus> {
    switch (provider) {
      case "centrinvest":
        return {
          available: Boolean(
            this.getValue("CENTRINVEST_API_KEY") &&
              this.getValue("CENTRINVEST_LLM_URL") &&
              this.getValue("CENTRINVEST_EMBEDDING_URL") &&
              this.getValue("CENTRINVEST_STT_URL"),
          ),
          reason: "Не заполнены параметры Centrinvest API",
        };

      case "gemini":
        return {
          available: Boolean(
            this.getValue("GEMINI_API_KEY") &&
              this.getValue("GEMINI_MODEL") &&
              this.getValue("GEMINI_EMBED_MODEL"),
          ),
          reason:
            "Добавьте GEMINI_API_KEY, GEMINI_MODEL и GEMINI_EMBED_MODEL в backend .env",
        };

      case "ollama":
        return this.checkOllamaHealth();
    }
  }

  private getValue(key: string) {
    return this.config.get<string>(key)?.trim();
  }

  private async checkOllamaHealth(): Promise<ProviderStatus> {
    const baseUrl = this.getValue("OLLAMA_BASE_URL");
    if (!baseUrl) {
      return {
        available: false,
        reason: "Добавьте OLLAMA_BASE_URL в backend .env",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/tags`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          available: false,
          reason: "Ollama не отвечает по OLLAMA_BASE_URL",
        };
      }

      const payload = (await response.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      const models = payload.models ?? [];
      const chatModel = this.getValue("OLLAMA_CHAT_MODEL");
      const embedModel = this.getValue("OLLAMA_EMBED_MODEL");

      if (!chatModel || !embedModel) {
        return {
          available: false,
          reason: "Добавьте OLLAMA_CHAT_MODEL и OLLAMA_EMBED_MODEL в backend .env",
        };
      }

      const hasModel = (expected: string) =>
        models.some((item) => {
          const name = item.name ?? item.model ?? "";
          return name === expected || name.startsWith(`${expected}:`);
        });

      if (!hasModel(chatModel)) {
        return {
          available: false,
          reason: `Модель Ollama ${chatModel} не загружена`,
        };
      }

      if (!hasModel(embedModel)) {
        return {
          available: false,
          reason: `Модель векторизации ${embedModel} не загружена в Ollama`,
        };
      }

      return {
        available: true,
        reason: null,
      };
    } catch {
      return {
        available: false,
        reason: "Ollama недоступен или не отвечает по OLLAMA_BASE_URL",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
