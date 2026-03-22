import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Embeddings } from "@langchain/core/embeddings";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { LlmProvider } from "./llm.service";

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private embedder?: Embeddings;
  private currentProvider: LlmProvider;

  constructor(private readonly config: ConfigService) {
    this.currentProvider = this.config.get<string>(
      "LLM_PROVIDER",
      "centrinvest",
    ) as LlmProvider;
    this.logger.log(`Embedding provider: ${this.currentProvider}`);
  }

  private getRequestTimeoutMs(provider: LlmProvider) {
    switch (provider) {
      case "centrinvest":
        return 15_000;
      case "gemini":
        return 10_000;
      case "ollama":
        return 8_000;
    }
  }

  private async withTimeout<T>(
    provider: LlmProvider,
    promise: Promise<T>,
    message: string,
  ) {
    const timeoutMs = this.getRequestTimeoutMs(provider);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(message));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private createEmbedder(provider: LlmProvider): Embeddings {
    switch (provider) {
      case "centrinvest":
        return new OpenAIEmbeddings({
          openAIApiKey: this.config.get("CENTRINVEST_API_KEY"),
          model: this.config.get("CENTRINVEST_EMBED_MODEL", ""),
          configuration: {
            baseURL: this.config.get("CENTRINVEST_EMBEDDING_URL"),
          },
        });

      case "gemini":
        return new GoogleGenerativeAIEmbeddings({
          apiKey: this.config.get("GEMINI_API_KEY"),
          model: this.config.get("GEMINI_EMBED_MODEL", "gemini-embedding-001"),
        });

      case "ollama":
        return new OllamaEmbeddings({
          baseUrl: this.config.get("OLLAMA_BASE_URL", "http://localhost:11434"),
          model: this.config.get("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        });
    }
  }

  private getEmbedder() {
    if (!this.embedder) {
      this.embedder = this.createEmbedder(this.currentProvider);
    }

    return this.embedder;
  }

  switchProvider(provider: LlmProvider): void {
    this.currentProvider = provider;
    this.embedder = undefined;
    this.logger.log(`Switched embedding provider to: ${provider}`);
  }

  async embed(text: string): Promise<number[]> {
    const embedding = await this.withTimeout(
      this.currentProvider,
      this.getEmbedder().embedQuery(text),
      "Сервис эмбеддингов слишком долго отвечает. Проверьте выбранный AI-провайдер.",
    );
    return this.normalizeDimensions(embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings = await this.withTimeout(
      this.currentProvider,
      this.getEmbedder().embedDocuments(texts),
      "Пакетная векторизация слишком долго отвечает. Проверьте выбранный AI-провайдер.",
    );
    return embeddings.map((embedding) => this.normalizeDimensions(embedding));
  }

  getDimensions(): number {
    return Number(this.config.get("EMBEDDING_DIMENSIONS", 1024));
  }

  private normalizeDimensions(embedding: number[]): number[] {
    const dimensions = this.getDimensions();

    if (embedding.length === dimensions) {
      return embedding;
    }

    if (embedding.length > dimensions) {
      this.logger.warn(
        `Embedding dimensions ${embedding.length} exceed configured ${dimensions}, truncating`,
      );
      return embedding.slice(0, dimensions);
    }

    this.logger.warn(
      `Embedding dimensions ${embedding.length} below configured ${dimensions}, padding`,
    );
    return [...embedding, ...Array(dimensions - embedding.length).fill(0)];
  }
}
