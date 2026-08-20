import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../../src/config/environment';
import { EnablePgvector20260804201511 } from '../../src/database/migrations/20260804201511-EnablePgvector';
import { CreateDocumentAndChunkSchema1786813200000 } from '../../src/database/migrations/1786813200000-CreateDocumentAndChunkSchema';
import { AddChunkContentSearchIndex1787248800000 } from '../../src/database/migrations/1787248800000-AddChunkContentSearchIndex';
import { Chunk } from '../../src/documents/entities/chunk.entity';
import {
  Document,
  DocumentStatus,
} from '../../src/documents/entities/document.entity';
import { EmbeddingService } from '../../src/embedding/embedding.service';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import { RetrievalStrategy } from '../../src/retrieval/retrieval-strategy';
import { RetrievalEvaluationRunner } from '../../src/evaluation/retrieval-evaluation.runner';
import { RetrievalBenchmarkRunner } from '../../src/evaluation/retrieval-benchmark.runner';
import { CandidateAnalysisRunner } from '../../src/evaluation/candidate-analysis';

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
        AddChunkContentSearchIndex1787248800000,
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

  function createRetrievalService(
    minimumSimilarity = 0.5,
    strategy: RetrievalStrategy = 'vector',
  ): RetrievalService {
    const embeddingService = { embedOne } as unknown as EmbeddingService;
    const configService = {
      get: jest.fn((key: keyof EnvironmentVariables) => {
        if (key === 'RETRIEVAL_TOP_K') return 5;
        if (key === 'RETRIEVAL_MIN_SIMILARITY') return minimumSimilarity;
        return strategy;
      }),
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

  it('creates the PostgreSQL full-text chunk index', async () => {
    const indexes = await dataSource.query<Array<{ indexdef: string }>>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = 'IDX_chunks_content_fts'`,
    );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING gin');
    expect(indexes[0]?.indexdef).toContain("to_tsvector('english'::regconfig");
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

  it('recovers lexical matches below the vector threshold and preserves filters', async () => {
    const includedDocument = await createDocument('included.pdf');
    const otherDocument = await createDocument('other.pdf');
    const processingDocument = await createDocument(
      'processing.pdf',
      DocumentStatus.PROCESSING,
    );
    const first = await createChunk(
      includedDocument,
      0,
      'Payroll access is mandatory.',
      vector([1, 1]),
    );
    const second = await createChunk(
      includedDocument,
      1,
      'Mandatory payroll controls apply.',
      vector([1, 1]),
    );
    await createChunk(
      otherDocument,
      0,
      'Mandatory payroll rules elsewhere.',
      vector([1, 1]),
    );
    await createChunk(
      processingDocument,
      0,
      'Mandatory payroll work in progress.',
      vector([0, 1]),
    );
    await createChunk(
      includedDocument,
      2,
      'Mandatory payroll without an embedding.',
      null,
    );

    const vectorResults = await createRetrievalService(0.75).search(
      'mandatory payroll',
      10,
      includedDocument.id,
    );
    const hybridResults = await createRetrievalService(0.75, 'hybrid').search(
      'mandatory payroll',
      10,
      includedDocument.id,
    );

    expect(vectorResults).toEqual([]);
    expect(hybridResults.map((result) => result.chunkId)).toEqual(
      [first.id, second.id].sort(),
    );
    expect(
      hybridResults.every(
        (result) => result.documentId === includedDocument.id,
      ),
    ).toBe(true);
  });

  it('diagnoses candidate removal before ranking', async () => {
    const document = await createDocument('policy.pdf');
    const relevant = await createChunk(
      document,
      0,
      'Mandatory payroll access applies.',
      vector([1, 1]),
    );
    const embeddingService = { embedOne } as unknown as EmbeddingService;
    const report = await new CandidateAnalysisRunner(
      dataSource,
      embeddingService,
      (strategy, minimumSimilarity) =>
        createRetrievalService(minimumSimilarity, strategy),
    ).run(
      {
        name: 'candidate-diagnostic',
        cases: [
          {
            id: 'guarded-match',
            question: 'mandatory systems control',
            expectedSources: [{ chunkId: relevant.id, filename: 'policy.pdf' }],
          },
        ],
      },
      [5],
      [-1, 0.75],
      { topK: 3, minimumSimilarity: 0.75 },
    );

    expect(
      report.candidateRecall.map((result) => ({
        strategy: result.strategy,
        threshold: result.minimumSimilarity,
        recall: result.metrics[0]?.recall,
      })),
    ).toEqual([
      { strategy: 'vector', threshold: -1, recall: 1 },
      { strategy: 'vector', threshold: 0.75, recall: 0 },
      { strategy: 'hybrid', threshold: -1, recall: 1 },
      { strategy: 'hybrid', threshold: 0.75, recall: 0 },
    ]);
    expect(report.failures).toEqual([
      expect.objectContaining({
        id: 'guarded-match',
        cause: 'candidate-generation',
        relevant: [
          expect.objectContaining({
            vectorRank: 1,
            rawLexicalRank: 1,
            guardedLexicalRank: null,
            hybridRank: null,
            removedByThreshold: true,
            removedByLexicalGuard: true,
          }),
        ],
      }),
    ]);
  });

  it('runs retrieval evaluation metrics through the real pgvector path', async () => {
    const document = await createDocument('evaluation.pdf');
    const expected = await createChunk(
      document,
      0,
      'expected result',
      vector([0, 1]),
    );
    await createChunk(document, 1, 'lower result', vector([0, 0.8], [1, 0.6]));

    const report = await new RetrievalEvaluationRunner(retrievalService).run(
      {
        name: 'integration-evaluation',
        cases: [
          {
            question: 'evaluation question',
            expectedSources: [
              { chunkId: expected.id, filename: 'evaluation.pdf' },
            ],
          },
        ],
      },
      [1, 2],
    );

    expect(report.metrics).toEqual([
      { k: 1, hitRate: 1, recall: 1, mrr: 1 },
      { k: 2, hitRate: 1, recall: 1, mrr: 1 },
    ]);
  });

  it('benchmarks topK and similarity thresholds through real pgvector retrieval', async () => {
    const document = await createDocument('benchmark.pdf');
    await createChunk(document, 0, 'high-ranked distractor', vector([0, 1]));
    const expectedA = await createChunk(
      document,
      1,
      'expected at rank two',
      vector([0, 0.9], [1, Math.sqrt(0.19)]),
    );
    const expectedB = await createChunk(
      document,
      2,
      'expected at rank three',
      vector([0, 0.7], [1, Math.sqrt(0.51)]),
    );

    const report = await new RetrievalBenchmarkRunner((configuration) =>
      createRetrievalService(
        configuration.minimumSimilarity,
        configuration.strategy,
      ),
    ).run(
      {
        name: 'deterministic-pgvector-benchmark',
        cases: [
          {
            question: 'find expected A',
            expectedSources: [{ chunkId: expectedA.id }],
          },
          {
            question: 'find expected B',
            expectedSources: [{ chunkId: expectedB.id }],
          },
        ],
      },
      [1, 3],
      [0.5, 0.8],
    );

    expect(report.configurations).toEqual([
      {
        rank: 1,
        configuration: {
          strategy: 'vector',
          topK: 3,
          minimumSimilarity: 0.5,
        },
        metrics: {
          k: 3,
          hitRate: 1,
          recall: 1,
          mrr: (1 / 2 + 1 / 3) / 2,
        },
      },
      {
        rank: 2,
        configuration: {
          strategy: 'vector',
          topK: 3,
          minimumSimilarity: 0.8,
        },
        metrics: { k: 3, hitRate: 0.5, recall: 0.5, mrr: 0.25 },
      },
      {
        rank: 3,
        configuration: {
          strategy: 'vector',
          topK: 1,
          minimumSimilarity: 0.8,
        },
        metrics: { k: 1, hitRate: 0, recall: 0, mrr: 0 },
      },
      {
        rank: 4,
        configuration: {
          strategy: 'vector',
          topK: 1,
          minimumSimilarity: 0.5,
        },
        metrics: { k: 1, hitRate: 0, recall: 0, mrr: 0 },
      },
    ]);
  });
});
