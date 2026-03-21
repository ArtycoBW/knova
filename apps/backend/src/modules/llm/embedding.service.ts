import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OllamaEmbeddings } from "@langchain/ollama";
import { LlmProvider } from "./llm.service";

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private embedder: Embeddings;
  private currentProvider: LlmProvider;

  constructor(private readonly config: ConfigService) {
    this.currentProvider = this.config.get<string>(
      "LLM_PROVIDER",
      "centrinvest",
    ) as LlmProvider;
    this.embedder = this.createEmbedder(this.currentProvider);
    this.logger.log(`Embedding provider: ${this.currentProvider}`);
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
          model: "text-embedding-004",
        });

      case "ollama":
        return new OllamaEmbeddings({
          baseUrl: this.config.get("OLLAMA_BASE_URL", "http://localhost:11434"),
          model: this.config.get("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        });
    }
  }

  switchProvider(provider: LlmProvider): void {
    this.currentProvider = provider;
    this.embedder = this.createEmbedder(provider);
    this.logger.log(`Switched embedding provider to: ${provider}`);
  }

  async embed(text: string): Promise<number[]> {
    const embedding = await this.embedder.embedQuery(text);
    return this.normalizeDimensions(embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings = await this.embedder.embedDocuments(texts);
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
