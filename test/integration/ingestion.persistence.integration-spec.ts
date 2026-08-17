import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../../src/config/environment';
import { EnablePgvector20260804201511 } from '../../src/database/migrations/20260804201511-EnablePgvector';
import { CreateDocumentAndChunkSchema1786813200000 } from '../../src/database/migrations/1786813200000-CreateDocumentAndChunkSchema';
import { Chunk } from '../../src/documents/entities/chunk.entity';
import {
  Document,
  DocumentStatus,
} from '../../src/documents/entities/document.entity';
import { EmbeddingService } from '../../src/embedding/embedding.service';
import {
  ChunkingService,
  TextChunk,
} from '../../src/ingestion/chunking.service';
import { IngestionProcessor } from '../../src/ingestion/ingestion.processor';
import { PdfParserService } from '../../src/ingestion/pdf-parser.service';

const TEST_DB_HOST = process.env.TEST_DB_HOST ?? '127.0.0.1';
const TEST_DB_PORT = Number(process.env.TEST_DB_PORT ?? 5435);
const TEST_DB_DATABASE =
  process.env.TEST_DB_DATABASE ?? 'documind_integration_test';

function assertIsolatedTestDatabase(): void {
  if (!TEST_DB_DATABASE.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against non-test database: ${TEST_DB_DATABASE}`,
    );
  }
  if (TEST_DB_PORT === 5434) {
    throw new Error(
      'Refusing to run integration tests on the DocuMind development database port 5434',
    );
  }
}

function vector(seed = 1): number[] {
  return Array.from({ length: 1536 }, (_, index) => (index === 0 ? seed : 0));
}

describe('Ingestion persistence integration', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    assertIsolatedTestDatabase();
    dataSource = new DataSource({
      type: 'postgres',
      host: TEST_DB_HOST,
      port: TEST_DB_PORT,
      username: process.env.TEST_DB_USERNAME ?? 'postgres',
      password: process.env.TEST_DB_PASSWORD ?? 'postgres',
      database: TEST_DB_DATABASE,
      entities: [Document, Chunk],
      migrations: [
        EnablePgvector20260804201511,
        CreateDocumentAndChunkSchema1786813200000,
      ],
      synchronize: false,
      installExtensions: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE "chunks", "documents" RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function createDocument(): Promise<Document> {
    return dataSource.getRepository(Document).save(
      dataSource.getRepository(Document).create({
        filename: 'integration.pdf',
        storagePath: 'integration.pdf',
        fileSizeBytes: 100,
        status: DocumentStatus.PENDING,
      }),
    );
  }

  it('persists and reloads a real vector(1536) chunk', async () => {
    const document = await createDocument();
    const chunkRepository = dataSource.getRepository(Chunk);
    await chunkRepository.save(
      chunkRepository.create({
        documentId: document.id,
        content: 'vector content',
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 3,
        embedding: vector(0.25),
      }),
    );

    const stored = await chunkRepository.findOneByOrFail({
      documentId: document.id,
      chunkIndex: 0,
    });
    const columnType = await dataSource.query<Array<{ type: string }>>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
       WHERE a.attrelid = 'chunks'::regclass AND a.attname = 'embedding'`,
    );

    expect(stored.embedding).toHaveLength(1536);
    expect(stored.embedding?.[0]).toBeCloseTo(0.25);
    expect(columnType[0]?.type).toBe('vector(1536)');
  });

  it('enforces unique chunk indexes and cascades document deletion', async () => {
    const document = await createDocument();
    const chunkRepository = dataSource.getRepository(Chunk);
    const createChunk = () =>
      chunkRepository.create({
        documentId: document.id,
        content: 'duplicate candidate',
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 3,
        embedding: vector(),
      });

    await chunkRepository.save(createChunk());
    await expect(chunkRepository.save(createChunk())).rejects.toThrow();

    await dataSource.getRepository(Document).delete({ id: document.id });
    await expect(
      chunkRepository.countBy({ documentId: document.id }),
    ).resolves.toBe(0);
  });

  it('rolls back partial chunks and replaces them exactly once on retry', async () => {
    const document = await createDocument();
    const chunkRepository = dataSource.getRepository(Chunk);
    await chunkRepository.save(
      chunkRepository.create({
        documentId: document.id,
        content: 'stale partial chunk',
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 4,
        embedding: vector(),
      }),
    );

    const pages = [{ pageNumber: 1, text: 'mocked page' }];
    let chunks: TextChunk[] = [
      { content: 'first', pageNumber: 1, chunkIndex: 0, tokenCount: 1 },
      { content: 'second', pageNumber: 1, chunkIndex: 1, tokenCount: 1 },
      { content: 'duplicate', pageNumber: 1, chunkIndex: 0, tokenCount: 1 },
    ];
    const pdfParser = {
      parseToPages: jest.fn().mockResolvedValue(pages),
    } as unknown as PdfParserService;
    const chunking = {
      chunkPages: jest.fn().mockImplementation(() => chunks),
    } as unknown as ChunkingService;
    const embedding = {
      embedBatch: jest
        .fn()
        .mockImplementation((texts: string[]) =>
          Promise.resolve(texts.map((_, index) => vector(index + 1))),
        ),
    } as unknown as EmbeddingService;
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
      data: { documentId: document.id },
    } as Job<{ documentId: string }>;

    await expect(processor.process(job)).rejects.toThrow();
    await expect(
      chunkRepository.countBy({ documentId: document.id }),
    ).resolves.toBe(0);
    await expect(
      dataSource.getRepository(Document).findOneByOrFail({ id: document.id }),
    ).resolves.toMatchObject({
      status: DocumentStatus.FAILED,
      pageCount: 0,
      chunkCount: 0,
    });

    chunks = [
      { content: 'first', pageNumber: 1, chunkIndex: 0, tokenCount: 1 },
      { content: 'second', pageNumber: 1, chunkIndex: 1, tokenCount: 1 },
      { content: 'third', pageNumber: 1, chunkIndex: 2, tokenCount: 1 },
    ];
    await processor.process(job);

    const storedChunks = await chunkRepository.find({
      where: { documentId: document.id },
      order: { chunkIndex: 'ASC' },
    });
    expect(storedChunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(new Set(storedChunks.map((chunk) => chunk.chunkIndex)).size).toBe(3);
    await expect(
      dataSource.getRepository(Document).findOneByOrFail({ id: document.id }),
    ).resolves.toMatchObject({
      status: DocumentStatus.COMPLETED,
      pageCount: 1,
      chunkCount: 3,
      errorMessage: null,
    });
  });
});
