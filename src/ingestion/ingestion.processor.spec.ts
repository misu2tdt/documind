import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { DataSource, EntityManager, Repository } from 'typeorm';
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

interface TestState {
  document: Document | null;
  chunks: Chunk[];
  chunkSaveCalls: number;
  failChunkSaveOnCall: number | null;
}

function createHarness() {
  const state: TestState = {
    document: {
      id: 'document-id',
      storagePath: 'document.pdf',
      status: DocumentStatus.PENDING,
      pageCount: 0,
      chunkCount: 0,
      errorMessage: 'stale error',
    } as Document,
    chunks: [],
    chunkSaveCalls: 0,
    failChunkSaveOnCall: null,
  };
  const pages = [
    { pageNumber: 1, text: 'page one' },
    { pageNumber: 2, text: 'page two' },
  ];
  const chunks: TextChunk[] = Array.from({ length: 5 }, (_, index) => ({
    content: `chunk-${index}`,
    pageNumber: index < 3 ? 1 : 2,
    chunkIndex: index,
    tokenCount: 2,
  }));

  const documentRepository = {
    findOne: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.document)),
    update: jest
      .fn()
      .mockImplementation((_criteria: unknown, values: Partial<Document>) => {
        if (!state.document) return Promise.resolve({ affected: 0 });
        Object.assign(state.document, values);
        return Promise.resolve({ affected: 1 });
      }),
  } as unknown as Repository<Document>;
  const chunkRepository = {
    delete: jest.fn().mockImplementation(() => {
      state.chunks = [];
      return Promise.resolve({ affected: 0 });
    }),
    create: jest.fn((value: Partial<Chunk>) => value as Chunk),
    save: jest.fn().mockImplementation((values: Chunk[]) => {
      state.chunkSaveCalls += 1;
      state.chunks.push(...values);
      if (state.chunkSaveCalls === state.failChunkSaveOnCall) {
        return Promise.reject(new Error('chunk persistence failed'));
      }
      return Promise.resolve(values);
    }),
  } as unknown as Repository<Chunk>;
  const manager = {
    getRepository: jest.fn((entity: typeof Document | typeof Chunk) =>
      entity === Document ? documentRepository : chunkRepository,
    ),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(
      async <T>(operation: (entityManager: EntityManager) => Promise<T>) => {
        const documentSnapshot = state.document ? { ...state.document } : null;
        const chunksSnapshot = [...state.chunks];

        try {
          return await operation(manager);
        } catch (error) {
          state.document = documentSnapshot;
          state.chunks = chunksSnapshot;
          throw error;
        }
      },
    ),
  } as unknown as DataSource;
  const pdfParser = {
    parseToPages: jest.fn().mockResolvedValue(pages),
  } as unknown as PdfParserService;
  const chunking = {
    chunkPages: jest.fn().mockReturnValue(chunks),
  } as unknown as ChunkingService;
  const embedBatch = jest
    .fn()
    .mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => [0, 0, 0])),
    );
  const embedding = { embedBatch } as unknown as EmbeddingService;
  const configService = {
    get: jest.fn().mockReturnValue(2),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const processor = new IngestionProcessor(
    dataSource,
    pdfParser,
    chunking,
    embedding,
    configService,
  );
  const job = {
    data: { documentId: 'document-id' },
  } as Job<{ documentId: string }>;

  return { state, processor, job, embedBatch };
}

describe('IngestionProcessor', () => {
  it('persists one complete chunk set and consistent document counts', async () => {
    const { state, processor, job, embedBatch } = createHarness();

    await processor.process(job);

    expect(embedBatch).toHaveBeenNthCalledWith(1, ['chunk-0', 'chunk-1']);
    expect(embedBatch).toHaveBeenNthCalledWith(2, ['chunk-2', 'chunk-3']);
    expect(embedBatch).toHaveBeenNthCalledWith(3, ['chunk-4']);
    expect(state.chunks).toHaveLength(5);
    expect(state.chunks.map((chunk) => chunk.chunkIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(state.document).toMatchObject({
      status: DocumentStatus.COMPLETED,
      pageCount: 2,
      chunkCount: 5,
      errorMessage: null,
    });
  });

  it('rolls back partial persistence and marks the document failed', async () => {
    const { state, processor, job } = createHarness();
    state.failChunkSaveOnCall = 2;

    await expect(processor.process(job)).rejects.toThrow(
      'chunk persistence failed',
    );

    expect(state.chunkSaveCalls).toBe(2);
    expect(state.chunks).toEqual([]);
    expect(state.document).toMatchObject({
      status: DocumentStatus.FAILED,
      pageCount: 0,
      chunkCount: 0,
      errorMessage: 'chunk persistence failed',
    });
  });

  it('retries after failure without duplicate chunks', async () => {
    const { state, processor, job } = createHarness();
    state.chunks = [
      { documentId: 'document-id', chunkIndex: 0 } as Chunk,
      { documentId: 'document-id', chunkIndex: 1 } as Chunk,
    ];
    state.failChunkSaveOnCall = 2;

    await expect(processor.process(job)).rejects.toThrow(
      'chunk persistence failed',
    );

    state.failChunkSaveOnCall = null;
    state.chunkSaveCalls = 0;
    await processor.process(job);

    const indexes = state.chunks.map((chunk) => chunk.chunkIndex);
    expect(indexes).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(indexes).size).toBe(5);
    expect(state.document).toMatchObject({
      status: DocumentStatus.COMPLETED,
      pageCount: 2,
      chunkCount: 5,
      errorMessage: null,
    });
  });

  it('does not recreate a document deleted while embeddings are generated', async () => {
    const { state, processor, job, embedBatch } = createHarness();
    embedBatch.mockImplementation((texts: string[]) => {
      state.document = null;
      return Promise.resolve(texts.map(() => [0, 0, 0]));
    });

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(state.document).toBeNull();
    expect(state.chunks).toEqual([]);
  });
});
