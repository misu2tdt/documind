import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/environment';
import { Chunk } from '../documents/entities/chunk.entity';
import {
  Document,
  DocumentStatus,
} from '../documents/entities/document.entity';
import { EmbeddingService } from '../embedding/embedding.service';
import { ChunkingService, TextChunk } from './chunking.service';
import { IngestionProcessor } from './ingestion.processor';
import { PdfParserService } from './pdf-parser.service';

describe('IngestionProcessor batching', () => {
  it('embeds and saves chunks using the configured numeric batch size', async () => {
    const document = {
      id: 'document-id',
      storagePath: 'document.pdf',
      status: DocumentStatus.PENDING,
      pageCount: 0,
      chunkCount: 0,
      errorMessage: null,
    } as Document;
    const chunks: TextChunk[] = Array.from({ length: 5 }, (_, index) => ({
      content: `chunk-${index}`,
      pageNumber: 1,
      chunkIndex: index,
      tokenCount: 2,
    }));

    const documentRepository = {
      findOne: jest.fn().mockResolvedValue(document),
      save: jest.fn().mockImplementation((value: Document) => value),
    } as unknown as Repository<Document>;
    const createChunk = jest.fn((value: Partial<Chunk>) => value);
    const saveChunks = jest.fn().mockImplementation((value: Chunk[]) => value);
    const chunkRepository = {
      create: createChunk,
      save: saveChunks,
    } as unknown as Repository<Chunk>;
    const pdfParser = {
      parseToPages: jest.fn().mockResolvedValue([{ pageNumber: 1, text: '' }]),
    } as unknown as PdfParserService;
    const chunking = {
      chunkPages: jest.fn().mockReturnValue(chunks),
    } as unknown as ChunkingService;
    const embedBatch = jest
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0, 0, 0])),
      );
    const embedding = {
      embedBatch,
    } as unknown as EmbeddingService;
    const configService = {
      get: jest.fn().mockReturnValue(2),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const processor = new IngestionProcessor(
      documentRepository,
      chunkRepository,
      pdfParser,
      chunking,
      embedding,
      configService,
    );

    await processor.process({
      data: { documentId: document.id },
    } as Job<{ documentId: string }>);

    expect(embedBatch).toHaveBeenNthCalledWith(1, ['chunk-0', 'chunk-1']);
    expect(embedBatch).toHaveBeenNthCalledWith(2, ['chunk-2', 'chunk-3']);
    expect(embedBatch).toHaveBeenNthCalledWith(3, ['chunk-4']);
    expect(saveChunks).toHaveBeenCalledTimes(3);
    expect(
      saveChunks.mock.calls.map(([batch]: [Chunk[]]) => batch.length),
    ).toEqual([2, 2, 1]);
    expect(document.status).toBe(DocumentStatus.COMPLETED);
    expect(document.chunkCount).toBe(5);
  });
});
