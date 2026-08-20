import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalBenchmarkResult } from './evaluation.types';
import {
  buildBenchmarkConfigurations,
  rankBenchmarkResults,
  RetrievalBenchmarkRunner,
} from './retrieval-benchmark.runner';

const relevant: RetrievalResultDto = {
  chunkId: 'relevant',
  documentId: 'document',
  filename: 'expected.pdf',
  pageNumber: 1,
  content: 'relevant',
  similarity: 0.8,
};
const irrelevant: RetrievalResultDto = {
  ...relevant,
  chunkId: 'irrelevant',
  filename: 'other.pdf',
  similarity: 0.9,
};

describe('RetrievalBenchmarkRunner', () => {
  it('compares a deterministic topK and threshold configuration grid', async () => {
    const runner = new RetrievalBenchmarkRunner((configuration) => {
      const retrieved =
        configuration.minimumSimilarity > 0.8
          ? []
          : configuration.topK === 1
            ? [irrelevant]
            : [irrelevant, relevant];
      return {
        search: jest.fn().mockResolvedValue(retrieved),
      } as unknown as RetrievalService;
    });

    const report = await runner.run(
      {
        name: 'comparison',
        cases: [
          {
            question: 'question',
            expectedSources: [{ chunkId: relevant.chunkId }],
          },
        ],
      },
      [2, 1],
      [0.9, 0.5],
    );

    expect(report.configurations.map((result) => result.configuration)).toEqual(
      [
        { strategy: 'vector', topK: 2, minimumSimilarity: 0.5 },
        { strategy: 'vector', topK: 1, minimumSimilarity: 0.9 },
        { strategy: 'vector', topK: 1, minimumSimilarity: 0.5 },
        { strategy: 'vector', topK: 2, minimumSimilarity: 0.9 },
      ],
    );
    expect(report.configurations[0]?.metrics).toEqual({
      k: 2,
      hitRate: 1,
      recall: 1,
      mrr: 0.5,
    });
  });

  it('builds unique configurations in stable numeric order', () => {
    expect(buildBenchmarkConfigurations([3, 1, 3], [0.7, 0.5, 0.7])).toEqual([
      { strategy: 'vector', topK: 1, minimumSimilarity: 0.5 },
      { strategy: 'vector', topK: 1, minimumSimilarity: 0.7 },
      { strategy: 'vector', topK: 3, minimumSimilarity: 0.5 },
      { strategy: 'vector', topK: 3, minimumSimilarity: 0.7 },
    ]);
  });

  it('builds configurations for vector and hybrid strategies', () => {
    expect(
      buildBenchmarkConfigurations([3], [0.2], ['vector', 'hybrid']),
    ).toEqual([
      { strategy: 'hybrid', topK: 3, minimumSimilarity: 0.2 },
      { strategy: 'vector', topK: 3, minimumSimilarity: 0.2 },
    ]);
  });

  it('ranks quality first and uses smaller topK for deterministic ties', () => {
    const results: RetrievalBenchmarkResult[] = [
      benchmarkResult(5, 0.5, 0.8, 0.7, 0.6),
      benchmarkResult(1, 0.5, 0.8, 0.7, 0.6),
      benchmarkResult(3, 0.7, 0.9, 0.8, 0.7),
    ];

    expect(
      rankBenchmarkResults(results).map((result) => ({
        rank: result.rank,
        topK: result.configuration.topK,
      })),
    ).toEqual([
      { rank: 1, topK: 3 },
      { rank: 2, topK: 1 },
      { rank: 3, topK: 5 },
    ]);
  });
});

function benchmarkResult(
  topK: number,
  minimumSimilarity: number,
  hitRate: number,
  recall: number,
  mrr: number,
): RetrievalBenchmarkResult {
  return {
    rank: 0,
    configuration: { strategy: 'vector', topK, minimumSimilarity },
    metrics: { k: topK, hitRate, recall, mrr },
  };
}
