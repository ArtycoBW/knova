process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import * as fs from "fs";
import * as path from "path";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { PrismaService } from "./modules/prisma/prisma.service";

async function syncEmbeddingColumn(
  prisma: PrismaService,
  targetDimensions: number,
) {
  const rows = await prisma.$queryRawUnsafe<{ atttypmod: number | null }[]>(
    `
      SELECT atttypmod
      FROM pg_attribute
      WHERE attrelid = '"DocumentChunk"'::regclass
        AND attname = 'embedding'
    `,
  );

  const currentDimensions = Number(rows[0]?.atttypmod ?? 0);

  if (!currentDimensions || currentDimensions === targetDimensions) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `ALTER TABLE "DocumentChunk" DROP COLUMN IF EXISTS "embedding_next"`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE "DocumentChunk" ADD COLUMN "embedding_next" vector(${targetDimensions})`,
    );

    if (currentDimensions < targetDimensions) {
      const padding = targetDimensions - currentDimensions;
      await tx.$executeRawUnsafe(`
        UPDATE "DocumentChunk"
        SET "embedding_next" = (
          '[' || trim(both '[]' from embedding::text) || repeat(',0', ${padding}) || ']'
        )::vector(${targetDimensions})
        WHERE embedding IS NOT NULL
      `);
    } else {
      await tx.$executeRawUnsafe(`
        UPDATE "DocumentChunk"
        SET "embedding_next" = (
          '[' || array_to_string(
            (string_to_array(trim(both '[]' from embedding::text), ','))[1:${targetDimensions}],
            ','
          ) || ']'
        )::vector(${targetDimensions})
        WHERE embedding IS NOT NULL
      `);
    }

    await tx.$executeRawUnsafe(
      `ALTER TABLE "DocumentChunk" DROP COLUMN "embedding"`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE "DocumentChunk" RENAME COLUMN "embedding_next" TO "embedding"`,
    );
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  });

  await app.register(multipart, {
    limits: {
      fileSize: parseInt(process.env.MAX_FILE_SIZE || "104857600", 10),
    },
  });

  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const avatarDir = path.join(uploadDir, "avatars");
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: avatarDir,
    prefix: "/uploads/avatars/",
    decorateReply: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const prisma = app.get(PrismaService);
  const embeddingDimensions = parseInt(
    process.env.EMBEDDING_DIMENSIONS || "1024",
    10,
  );
  await syncEmbeddingColumn(prisma, embeddingDimensions);

  const config = new DocumentBuilder()
    .setTitle("Knova API")
    .setDescription("AI-платформа глубокой переработки знаний")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port, "0.0.0.0");
  console.log(`Knova API running on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
}

bootstrap();
