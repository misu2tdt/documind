import { RetrievalService } from '../retrieval/retrieval.service';
import {
  RETRIEVAL_STRATEGIES,
  RetrievalStrategy,
} from '../retrieval/retrieval-strategy';
import {
  RetrievalBenchmarkConfiguration,
  RetrievalBenchmarkReport,
  RetrievalBenchmarkResult,
  RetrievalEvaluationDataset,
} from './evaluation.types';
import { normalizeKValues } from './metrics';
import { RetrievalEvaluationRunner } from './retrieval-evaluation.runner';

export type RetrievalServiceFactory = (
  configuration: RetrievalBenchmarkConfiguration,
) => RetrievalService;

export class RetrievalBenchmarkRunner {
  constructor(private readonly serviceFactory: RetrievalServiceFactory) {}

  async run(
    dataset: RetrievalEvaluationDataset,
    topKValues: number[],
    similarityThresholds: number[],
    strategies: RetrievalStrategy[] = ['vector'],
  ): Promise<RetrievalBenchmarkReport> {
    const configurations = buildBenchmarkConfigurations(
      topKValues,
      similarityThresholds,
      strategies,
    );
    const results: RetrievalBenchmarkResult[] = [];

    for (const configuration of configurations) {
      const evaluation = await new RetrievalEvaluationRunner(
        this.serviceFactory(configuration),
      ).run(dataset, [configuration.topK]);
      results.push({
        rank: 0,
        configuration,
        metrics: evaluation.metrics[0],
      });
    }

    return {
      dataset: dataset.name,
      generatedAt: new Date().toISOString(),
      configurations: rankBenchmarkResults(results),
    };
  }
}

export function buildBenchmarkConfigurations(
  topKValues: number[],
  similarityThresholds: number[],
  strategies: RetrievalStrategy[] = ['vector'],
): RetrievalBenchmarkConfiguration[] {
  const normalizedTopK = normalizeKValues(topKValues);
  const normalizedThresholds = [...new Set(similarityThresholds)].sort(
    (left, right) => left - right,
  );
  if (
    normalizedThresholds.length === 0 ||
    normalizedThresholds.some(
      (threshold) =>
        !Number.isFinite(threshold) || threshold < -1 || threshold > 1,
    )
  ) {
    throw new Error('Similarity thresholds must be numbers between -1 and 1');
  }
  const normalizedStrategies = [...new Set(strategies)].sort();
  if (
    normalizedStrategies.length === 0 ||
    normalizedStrategies.some(
      (strategy) => !RETRIEVAL_STRATEGIES.includes(strategy),
    )
  ) {
    throw new Error('Retrieval strategies must be vector or hybrid');
  }

  return normalizedStrategies.flatMap((strategy) =>
    normalizedTopK.flatMap((topK) =>
      normalizedThresholds.map((minimumSimilarity) => ({
        strategy,
        topK,
        minimumSimilarity,
      })),
    ),
  );
}

export function rankBenchmarkResults(
  results: RetrievalBenchmarkResult[],
): RetrievalBenchmarkResult[] {
  return [...results]
    .sort(
      (left, right) =>
        right.metrics.recall - left.metrics.recall ||
        right.metrics.mrr - left.metrics.mrr ||
        right.metrics.hitRate - left.metrics.hitRate ||
        left.configuration.topK - right.configuration.topK ||
        right.configuration.minimumSimilarity -
          left.configuration.minimumSimilarity ||
        left.configuration.strategy.localeCompare(right.configuration.strategy),
    )
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

export function formatBenchmarkComparison(
  report: RetrievalBenchmarkReport,
): string {
  const lines = [
    `Retrieval benchmark: ${report.dataset}`,
    '',
    'Rank\tStrategy\tTopK\tThreshold\tHit Rate@K\tRecall@K\tMRR@K',
  ];
  for (const result of report.configurations) {
    lines.push(
      `${result.rank}\t${result.configuration.strategy}\t${result.configuration.topK}\t${result.configuration.minimumSimilarity.toFixed(2)}\t\t${percent(result.metrics.hitRate)}\t\t${percent(result.metrics.recall)}\t\t${result.metrics.mrr.toFixed(4)}`,
    );
  }
  return lines.join('\n');
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
