import { ConfigService } from '@nestjs/config';
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
import { RetrievalService } from '../../src/retrieval/retrieval.service';

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

function vector(...entries: Array<[number, number]>): number[] {
  const result = Array<number>(1536).fill(0);
  for (const [index, value] of entries) result[index] = value;
  return result;
}

describe('Retrieval integration', () => {
  let dataSource: DataSource;
  let retrievalService: RetrievalService;
  const embedOne = jest.fn();

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

    retrievalService = createRetrievalService();
  });

  beforeEach(async () => {
    embedOne.mockReset();
    embedOne.mockResolvedValue(vector([0, 1]));
    await dataSource.query(
      `TRUNCATE TABLE "chunks", "documents" RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  function createRetrievalService(minimumSimilarity = 0.5): RetrievalService {
    const embeddingService = { embedOne } as unknown as EmbeddingService;
    const configService = {
      get: jest.fn((key: keyof EnvironmentVariables) =>
        key === 'RETRIEVAL_TOP_K' ? 5 : minimumSimilarity,
      ),
    } as unknown as ConfigService<EnvironmentVariables, true>;
    return new RetrievalService(dataSource, embeddingService, configService);
  }

  async function createDocument(
    filename: string,
    status = DocumentStatus.COMPLETED,
  ): Promise<Document> {
    const repository = dataSource.getRepository(Document);
    return repository.save(
      repository.create({
        filename,
        storagePath: filename,
        fileSizeBytes: 100,
        status,
      }),
    );
  }

  async function createChunk(
    document: Document,
    chunkIndex: number,
    content: string,
    embedding: number[] | null,
  ): Promise<Chunk> {
    const repository = dataSource.getRepository(Chunk);
    return repository.save(
      repository.create({
        documentId: document.id,
        content,
        pageNumber: chunkIndex + 1,
        chunkIndex,
        tokenCount: 2,
        embedding,
      }),
    );
  }

  it('ranks chunks by cosine similarity and respects topK', async () => {
    const firstDocument = await createDocument('first.pdf');
    const secondDocument = await createDocument('second.pdf');
    const exact = await createChunk(
      firstDocument,
      0,
      'exact match',
      vector([0, 1]),
    );
    const close = await createChunk(
      secondDocument,
      0,
      'close match',
      vector([0, 0.8], [1, 0.6]),
    );
    await createChunk(firstDocument, 1, 'orthogonal match', vector([1, 1]));

    const results = await retrievalService.search('query text', 2);

    expect(results.map((result) => result.chunkId)).toEqual([
      exact.id,
      close.id,
    ]);
    expect(results[0]).toMatchObject({
      documentId: firstDocument.id,
      filename: 'first.pdf',
      pageNumber: 1,
      content: 'exact match',
    });
    expect(results[0]?.similarity).toBeCloseTo(1);
    expect(results[1]?.similarity).toBeCloseTo(0.8);
  });

  it('filters results by documentId before ranking', async () => {
    const firstDocument = await createDocument('first.pdf');
    const secondDocument = await createDocument('second.pdf');
    await createChunk(firstDocument, 0, 'excluded exact match', vector([0, 1]));
    const included = await createChunk(
      secondDocument,
      0,
      'included close match',
      vector([0, 0.8], [1, 0.6]),
    );

    const results = await retrievalService.search(
      'query text',
      5,
      secondDocument.id,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      chunkId: included.id,
      documentId: secondDocument.id,
      filename: 'second.pdf',
    });
  });

  it('applies the similarity threshold and excludes incomplete documents and null embeddings', async () => {
    const completed = await createDocument('completed.pdf');
    const processing = await createDocument(
      'processing.pdf',
      DocumentStatus.PROCESSING,
    );
    const included = await createChunk(
      completed,
      0,
      'above threshold',
      vector([0, 0.8], [1, 0.6]),
    );
    await createChunk(
      completed,
      1,
      'below threshold',
      vector([0, 0.7], [1, Math.sqrt(0.51)]),
    );
    await createChunk(processing, 0, 'incomplete exact match', vector([0, 1]));
    await createChunk(completed, 2, 'missing embedding', null);

    const results = await createRetrievalService(0.75).search('query text', 10);

    expect(results).toHaveLength(1);
    expect(results[0]?.chunkId).toBe(included.id);
  });

  it('orders equal similarity scores deterministically by chunk id', async () => {
    const document = await createDocument('ties.pdf');
    const first = await createChunk(document, 0, 'first tie', vector([0, 1]));
    const second = await createChunk(document, 1, 'second tie', vector([0, 1]));

    const results = await retrievalService.search('query text', 5);

    expect(results.map((result) => result.chunkId)).toEqual(
      [first.id, second.id].sort(),
    );
  });
});
