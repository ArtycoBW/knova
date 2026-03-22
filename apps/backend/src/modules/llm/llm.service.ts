import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
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

export interface ProviderInfo {
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

  private getDefaultTemperature() {
    return this.currentProvider === "gemini" ? 0 : 0.7;
  }

  private getGeminiSafetySettings() {
    return [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ];
  }

  private createModel(options?: ChatOptions) {
    const temperature = options?.temperature ?? this.getDefaultTemperature();
    const maxTokens = options?.maxTokens;

    switch (this.currentProvider) {
      case "centrinvest":
        return new ChatOpenAI({
          openAIApiKey: this.config.get("CENTRINVEST_API_KEY"),
          model: this.config.get("CENTRINVEST_LLM_MODEL", "gpt-oss-20b"),
          configuration: {
            baseURL: this.config.get("CENTRINVEST_LLM_URL"),
          },
          temperature,
          maxTokens,
        });

      case "gemini":
        return new ChatGoogleGenerativeAI({
          apiKey: this.config.get("GEMINI_API_KEY"),
          model: this.config.get("GEMINI_MODEL", "gemini-2.5-flash"),
          temperature,
          topP: 0,
          maxOutputTokens: maxTokens,
          safetySettings: this.getGeminiSafetySettings(),
        });

      case "ollama":
        return new ChatOllama({
          baseUrl: this.config.get(
            "OLLAMA_BASE_URL",
            "http://localhost:11434",
          ),
          model: this.config.get("OLLAMA_CHAT_MODEL", "llama3.2"),
          temperature,
          checkOrPullModel: false,
        });
    }
  }

  private getRequestTimeoutMs() {
    switch (this.currentProvider) {
      case "centrinvest":
        return 30_000;
      case "gemini":
        return 18_000;
      case "ollama":
        return 10_000;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, message: string) {
    const timeoutMs = this.getRequestTimeoutMs();
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
    const response = await this.withTimeout(
      model.invoke([new HumanMessage(prompt)]),
      "AI-провайдер слишком долго отвечает на запрос.",
    );
    return response.content as string;
  }

  async chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: ChatOptions,
  ): Promise<string> {
    const model = this.createModel(options);
    const response = await this.withTimeout(
      model.invoke(this.toMessages(messages)),
      "AI-провайдер слишком долго отвечает на запрос.",
    );
    return response.content as string;
  }

  async *chatStream(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: ChatOptions,
  ): AsyncIterable<string> {
    const model = this.createModel(options);
    const stream = await this.withTimeout(
      model.stream(this.toMessages(messages)),
      "AI-провайдер слишком долго начинает генерацию ответа.",
    );
    const iterator = stream[Symbol.asyncIterator]();

    while (true) {
      const nextChunk = await this.withTimeout(
        iterator.next(),
        "AI-провайдер слишком долго не присылает следующую часть ответа.",
      );

      if (nextChunk.done) {
        break;
      }

      const text = nextChunk.value.content as string;
      if (text) {
        yield text;
      }
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
        return this.config.get("CENTRINVEST_LLM_MODEL", "gpt-oss-20b");
      case "gemini":
        return this.config.get("GEMINI_MODEL", "gemini-2.5-flash");
      case "ollama":
        return this.config.get("OLLAMA_CHAT_MODEL", "llama3.2");
    }
  }
}
