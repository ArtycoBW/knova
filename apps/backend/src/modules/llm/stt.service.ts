import {
  Injectable,
  Logger,
  NotImplementedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as ffmpeg from "fluent-ffmpeg";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
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
      case "ollama":
        throw new NotImplementedException("STT недоступен в этом режиме");
    }
  }

  private async transcribeCentrinvest(
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    const url = this.config.get<string>("CENTRINVEST_STT_URL");
    const apiKey = this.config.get<string>("CENTRINVEST_API_KEY");
    const model = this.config.get<string>(
      "CENTRINVEST_STT_MODEL",
      "whisper-large-v3-turbo",
    );

    const prepared = await this.prepareAudio(buffer, mimetype);

    for (const endpoint of this.getEndpoints(url)) {
      const response = await this.fetchWithRetry(endpoint, prepared, model, apiKey);

      if (response.ok) {
        const data = (await response.json()) as { text: string };
        return data.text;
      }

      const errorText = await response.text();
      if (response.status === 404) {
        continue;
      }

      this.logger.error(`STT error: ${response.status} ${errorText}`);
      throw new Error(`STT transcription failed: ${response.status}`);
    }

    this.logger.error("STT error: 404 endpoint not found");
    throw new Error("STT transcription failed: 404");
  }

  private async fetchWithRetry(
    endpoint: string,
    prepared: { buffer: Buffer; mimetype: string },
    model: string,
    apiKey?: string,
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const formData = new FormData();
      formData.append(
        "file",
        new Blob([new Uint8Array(prepared.buffer)], { type: prepared.mimetype }),
        `audio.${this.getExtension(prepared.mimetype)}`,
      );
      formData.append("model", model);

      try {
        return await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        });
      } catch (error) {
        lastError = error;

        if (attempt === 2) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("STT request failed");
  }

  private async prepareAudio(buffer: Buffer, mimetype: string) {
    const normalizedMimeType = this.normalizeMimeType(mimetype);

    if (this.isDirectlySupportedMimeType(normalizedMimeType)) {
      return {
        buffer,
        mimetype: normalizedMimeType,
      };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "knova-stt-"));
    const inputPath = path.join(
      tempDir,
      `input.${this.getExtension(normalizedMimeType)}`,
    );
    const outputPath = path.join(tempDir, "output.mp3");

    try {
      await fs.writeFile(inputPath, buffer);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libmp3lame")
          .format("mp3")
          .save(outputPath)
          .on("end", () => resolve())
          .on("error", (error) => reject(error));
      });

      return {
        buffer: await fs.readFile(outputPath),
        mimetype: "audio/mpeg",
      };
    } finally {
      await Promise.allSettled([
        fs.rm(tempDir, { recursive: true, force: true }),
      ]);
    }
  }

  private normalizeMimeType(mimetype: string) {
    return mimetype.split(";")[0]?.trim().toLowerCase() || "audio/webm";
  }

  private isDirectlySupportedMimeType(mimetype: string) {
    return [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
      "audio/x-m4a",
      "audio/m4a",
      "audio/mp4",
    ].includes(mimetype);
  }

  private getEndpoints(url?: string): string[] {
    const baseUrl = (url || "").replace(/\/+$/, "");
    if (!baseUrl) {
      return [];
    }

    const direct = `${baseUrl}/audio/transcriptions`;
    const withV1 = baseUrl.endsWith("/v1")
      ? direct
      : `${baseUrl}/v1/audio/transcriptions`;

    return direct === withV1 ? [direct] : [direct, withV1];
  }

  private getExtension(mimetype: string): string {
    const normalizedMimeType = this.normalizeMimeType(mimetype);
    const map: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/wave": "wav",
      "audio/ogg": "ogg",
      "audio/x-m4a": "m4a",
      "audio/m4a": "m4a",
      "audio/mp4": "m4a",
      "video/mp4": "mp4",
      "audio/webm": "webm",
      "video/webm": "webm",
      "video/quicktime": "mov",
    };
    return map[normalizedMimeType] || "mp3";
  }
}
