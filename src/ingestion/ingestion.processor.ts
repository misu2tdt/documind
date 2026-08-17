import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { Job } from 'bullmq';
import {
  Document,
  DocumentStatus,
} from '../documents/entities/document.entity';
import { Chunk } from '../documents/entities/chunk.entity';
import { PdfParserService } from './pdf-parser.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EnvironmentVariables } from '../config/environment';

export const INGESTION_QUEUE = 'ingestion';

class DocumentUnavailableError extends Error {}

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);
  private readonly batchSize: number;

  constructor(
    private dataSource: DataSource,
    private pdfParser: PdfParserService,
    private chunking: ChunkingService,
    private embedding: EmbeddingService,
    private configService: ConfigService<EnvironmentVariables, true>,
  ) {
    super();
    this.batchSize = this.configService.get('EMBEDDING_BATCH_SIZE', {
      infer: true,
    });
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`Processing document ${documentId}`);

    const document = await this.prepareAttempt(documentId);
    if (!document) {
      this.logger.warn(`Document ${documentId} not found, skipping`);
      return;
    }

    try {
      const pages = await this.pdfParser.parseToPages(document.storagePath);
      const chunks = this.chunking.chunkPages(pages);

      if (chunks.length === 0) {
        throw new Error('Không trích xuất được nội dung từ PDF.');
      }

      const vectors = await this.embedChunks(chunks);
      await this.completeAttempt(document.id, pages.length, chunks, vectors);

      this.logger.log(
        `Completed ${documentId}: ${pages.length} pages, ${chunks.length} chunks`,
      );
    } catch (error) {
      if (error instanceof DocumentUnavailableError) {
        this.logger.warn(error.message);
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const markedFailed = await this.markAttemptFailed(documentId, message);

      if (!markedFailed) {
        this.logger.warn(
          `Document ${documentId} was deleted or superseded while processing`,
        );
        return;
      }

      this.logger.error(`Failed ${documentId}: ${message}`);
      throw error;
    }
  }

  private async prepareAttempt(documentId: string): Promise<Document | null> {
    return this.dataSource.transaction(async (manager) => {
      const documentRepository = manager.getRepository(Document);
      const document = await documentRepository.findOne({
        where: { id: documentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!document) return null;

      await manager.getRepository(Chunk).delete({ documentId });
      await documentRepository.update(
        { id: documentId },
        {
          status: DocumentStatus.PROCESSING,
          pageCount: 0,
          chunkCount: 0,
          errorMessage: null,
        },
      );

      document.status = DocumentStatus.PROCESSING;
      document.pageCount = 0;
      document.chunkCount = 0;
      document.errorMessage = null;
      return document;
    });
  }

  private async embedChunks(
    chunks: ReturnType<ChunkingService['chunkPages']>,
  ): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map((c) => c.content);
      vectors.push(...(await this.embedding.embedBatch(texts)));
    }

    return vectors;
  }

  private async completeAttempt(
    documentId: string,
    pageCount: number,
    chunks: ReturnType<ChunkingService['chunkPages']>,
    vectors: number[][],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const documentRepository = manager.getRepository(Document);
      const document = await documentRepository.findOne({
        where: { id: documentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!document || document.status !== DocumentStatus.PROCESSING) {
        throw new DocumentUnavailableError(
          `Document ${documentId} was deleted or superseded before completion`,
        );
      }

      const chunkRepository = manager.getRepository(Chunk);
      await chunkRepository.delete({ documentId });

      for (let i = 0; i < chunks.length; i += this.batchSize) {
        const batch = chunks.slice(i, i + this.batchSize);
        const entities = batch.map((chunk, index) =>
          chunkRepository.create({
            documentId,
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
            embedding: vectors[i + index],
          }),
        );

        await chunkRepository.save(entities);
      }

      await documentRepository.update(
        { id: documentId },
        {
          status: DocumentStatus.COMPLETED,
          pageCount,
          chunkCount: chunks.length,
          errorMessage: null,
        },
      );
    });
  }

  private async markAttemptFailed(
    documentId: string,
    errorMessage: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const documentRepository = manager.getRepository(Document);
      const document = await documentRepository.findOne({
        where: { id: documentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!document || document.status !== DocumentStatus.PROCESSING) {
        return false;
      }

      await manager.getRepository(Chunk).delete({ documentId });
      await documentRepository.update(
        { id: documentId },
        {
          status: DocumentStatus.FAILED,
          pageCount: 0,
          chunkCount: 0,
          errorMessage,
        },
      );

      return true;
    });
  }
}
