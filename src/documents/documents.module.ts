import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';
import { Chunk } from './entities/chunk.entity';
import { IngestionProcessor, INGESTION_QUEUE } from '../ingestion/ingestion.processor';
import { PdfParserService } from '../ingestion/pdf-parser.service';
import { ChunkingService } from '../ingestion/chunking.service';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Chunk]),
    EmbeddingModule,
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: (config.get<number>('MAX_FILE_SIZE_MB') ?? 20) * 1024 * 1024,
        },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    IngestionProcessor,
    PdfParserService,
    ChunkingService,
  ],
})
export class DocumentsModule {}