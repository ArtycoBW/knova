import { Injectable, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "./queue.module";

@Injectable()
export class BullBoardPlugin implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.DOCUMENT_PROCESSING)
    private readonly docQueue: Queue,
    @InjectQueue(QUEUE_NAMES.AUDIO_PROCESSING)
    private readonly audioQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MINDMAP_GENERATION)
    private readonly mindmapQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PODCAST_GENERATION)
    private readonly podcastQueue: Queue,
    @InjectQueue(QUEUE_NAMES.QUIZ_GENERATION)
    private readonly quizQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REPORT_GENERATION)
    private readonly reportQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INFOGRAPHIC_GENERATION)
    private readonly infographicQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TABLE_EXTRACTION)
    private readonly tableQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRESENTATION_GENERATION)
    private readonly presentationQueue: Queue,
  ) {}

  async onModuleInit() {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath("/admin/queues");

    createBullBoard({
      queues: [
        this.docQueue,
        this.audioQueue,
        this.mindmapQueue,
        this.podcastQueue,
        this.quizQueue,
        this.reportQueue,
        this.infographicQueue,
        this.tableQueue,
        this.presentationQueue,
      ].map((q) => new BullMQAdapter(q)),
      serverAdapter,
    });

    const fastifyInstance = this.httpAdapterHost.httpAdapter.getInstance();
    await fastifyInstance.register(serverAdapter.registerPlugin(), {
      basePath: "/admin/queues",
      prefix: "/admin/queues",
    });
  }
}
