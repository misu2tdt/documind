import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Document, DocumentStatus } from '../documents/entities/document.entity';
import { Chunk } from '../documents/entities/chunk.entity';
import { PdfParserService } from './pdf-parser.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from '../embedding/embedding.service';

export const INGESTION_QUEUE = 'ingestion';

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);
  private readonly batchSize: number;

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(Chunk)
    private chunkRepository: Repository<Chunk>,
    private pdfParser: PdfParserService,
    private chunking: ChunkingService,
    private embedding: EmbeddingService,
    private configService: ConfigService,
  ) {
    super();
    this.batchSize =
      this.configService.get<number>('EMBEDDING_BATCH_SIZE') ?? 50;
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`Processing document ${documentId}`);

    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });
    if (!document) {
      this.logger.warn(`Document ${documentId} not found, skipping`);
      return;
    }

    try {
      document.status = DocumentStatus.PROCESSING;
      await this.documentRepository.save(document);

      const pages = await this.pdfParser.parseToPages(document.storagePath);
      const chunks = this.chunking.chunkPages(pages);

      if (chunks.length === 0) {
        throw new Error('Không trích xuất được nội dung từ PDF.');
      }

      await this.embedAndSaveChunks(document, chunks);

      document.status = DocumentStatus.COMPLETED;
      document.pageCount = pages.length;
      document.chunkCount = chunks.length;
      document.errorMessage = null;
      await this.documentRepository.save(document);

      this.logger.log(
        `Completed ${documentId}: ${pages.length} pages, ${chunks.length} chunks`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed ${documentId}: ${message}`);

      document.status = DocumentStatus.FAILED;
      document.errorMessage = message;
      await this.documentRepository.save(document);

      throw error;
    }
  }

  private async embedAndSaveChunks(
    document: Document,
    chunks: ReturnType<ChunkingService['chunkPages']>,
  ): Promise<void> {
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map((c) => c.content);

      const vectors = await this.embedding.embedBatch(texts);

      const entities = batch.map((chunk, idx) =>
        this.chunkRepository.create({
          documentId: document.id,
          content: chunk.content,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          embedding: vectors[idx],
        }),
      );

      await this.chunkRepository.save(entities);
      this.logger.log(
        `Saved batch ${i / this.batchSize + 1}: ${entities.length} chunks`,
      );
    }
  }
}