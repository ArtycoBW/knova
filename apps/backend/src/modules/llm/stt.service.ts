import {
  Injectable,
  Logger,
  NotImplementedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LlmProvider } from "./llm.service";

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name);
  private currentProvider: LlmProvider;

  constructor(private readonly config: ConfigService) {
    this.currentProvider = this.config.get<string>(
      "LLM_PROVIDER",
      "centrinvest",
    ) as LlmProvider;
    this.logger.log(
      `STT provider: ${this.currentProvider} (available: ${this.isAvailable()})`,
    );
  }

  isAvailable(): boolean {
    return this.currentProvider === "centrinvest";
  }

  switchProvider(provider: LlmProvider): void {
    this.currentProvider = provider;
  }

  async transcribe(buffer: Buffer, mimetype: string): Promise<string> {
    switch (this.currentProvider) {
      case "centrinvest":
        return this.transcribeCentrinvest(buffer, mimetype);
      case "gemini":
        throw new NotImplementedException(
          "STT недоступен в режиме Gemini",
        );
      case "ollama":
        throw new NotImplementedException(
          "STT недоступен в режиме Ollama (нужен локальный whisper)",
        );
    }
  }

  private async transcribeCentrinvest(
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    const url = this.config.get<string>("CENTRINVEST_STT_URL");
    const apiKey = this.config.get<string>("CENTRINVEST_API_KEY");

    const ext = this.getExtension(mimetype);
    const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });

    const formData = new FormData();
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", "whisper-1");

    const response = await fetch(`${url}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`STT error: ${response.status} ${errorText}`);
      throw new Error(`STT transcription failed: ${response.status}`);
    }

    const data = (await response.json()) as { text: string };
    return data.text;
  }

  private getExtension(mimetype: string): string {
    const map: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/wave": "wav",
      "audio/ogg": "ogg",
      "audio/m4a": "m4a",
      "audio/mp4": "m4a",
      "video/mp4": "mp4",
      "audio/webm": "webm",
    };
    return map[mimetype] || "mp3";
  }
}
