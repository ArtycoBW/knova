import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  type BaseMessage,
} from "@langchain/core/messages";

export type LlmProvider = "centrinvest" | "gemini" | "ollama";

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

interface ProviderInfo {
  provider: LlmProvider;
  model: string;
  sttAvailable: boolean;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private currentProvider: LlmProvider;

  constructor(private readonly config: ConfigService) {
    this.currentProvider = this.config.get<string>(
      "LLM_PROVIDER",
      "centrinvest",
    ) as LlmProvider;
    this.logger.log(`LLM provider: ${this.currentProvider}`);
  }

  private createModel(options?: ChatOptions) {
    const temperature = options?.temperature ?? 0.7;
    const maxTokens = options?.maxTokens;

    switch (this.currentProvider) {
      case "centrinvest":
        return new ChatOpenAI({
          openAIApiKey: this.config.get("CENTRINVEST_API_KEY"),
          configuration: {
            baseURL: this.config.get("CENTRINVEST_LLM_URL"),
          },
          temperature,
          maxTokens,
        });

      case "gemini":
        return new ChatGoogleGenerativeAI({
          apiKey: this.config.get("GEMINI_API_KEY"),
          model: this.config.get("GEMINI_MODEL", "gemini-2.0-flash"),
          temperature,
          maxOutputTokens: maxTokens,
        });

      case "ollama":
        return new ChatOllama({
          baseUrl: this.config.get(
            "OLLAMA_BASE_URL",
            "http://localhost:11434",
          ),
          model: this.config.get("OLLAMA_CHAT_MODEL", "llama3.2"),
          temperature,
        });
    }
  }

  private toMessages(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ): BaseMessage[] {
    return messages.map((m) => {
      switch (m.role) {
        case "system":
          return new SystemMessage(m.content);
        case "assistant":
          return new AIMessage(m.content);
        default:
          return new HumanMessage(m.content);
      }
    });
  }

  switchProvider(provider: LlmProvider): void {
    this.currentProvider = provider;
    this.logger.log(`Switched LLM provider to: ${provider}`);
  }

  async complete(prompt: string, options?: ChatOptions): Promise<string> {
    const model = this.createModel(options);
    const response = await model.invoke([new HumanMessage(prompt)]);
    return response.content as string;
  }

  async chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: ChatOptions,
  ): Promise<string> {
    const model = this.createModel(options);
    const response = await model.invoke(this.toMessages(messages));
    return response.content as string;
  }

  async *chatStream(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: ChatOptions,
  ): AsyncIterable<string> {
    const model = this.createModel(options);
    const stream = await model.stream(this.toMessages(messages));
    for await (const chunk of stream) {
      const text = chunk.content as string;
      if (text) yield text;
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      provider: this.currentProvider,
      model: this.getModelName(),
      sttAvailable: this.currentProvider === "centrinvest",
    };
  }

  private getModelName(): string {
    switch (this.currentProvider) {
      case "centrinvest":
        return "centrinvest-llm";
      case "gemini":
        return this.config.get("GEMINI_MODEL", "gemini-2.0-flash");
      case "ollama":
        return this.config.get("OLLAMA_CHAT_MODEL", "llama3.2");
    }
  }
}
