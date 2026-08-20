import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalStrategy } from '../retrieval/retrieval-strategy';
import {
  createBaselineComparison,
  rankBaselineComparisons,
} from './baseline-analysis';
import { loadEvaluationDataset } from './dataset';
import { deterministicEmbedding } from './deterministic-embedding';
import { createEvaluationDataSource } from './evaluation-data-source';
import {
  EvaluationCaseRun,
  RetrievalBenchmarkConfiguration,
  RetrievalBenchmarkResult,
} from './evaluation.types';
import { sourceMatches } from './metrics';
import {
  formatBenchmarkComparison,
  RetrievalBenchmarkRunner,
} from './retrieval-benchmark.runner';
import { RetrievalEvaluationRunner } from './retrieval-evaluation.runner';

interface Options {
  datasetPath: string;
  outputPath: string;
  topKValues: number[];
  thresholds: number[];
  strategies: RetrievalStrategy[];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dataset = await loadEvaluationDataset(options.datasetPath);
  const dataSource = createEvaluationDataSource();
  const embeddingService = {
    embedOne: (text: string) => Promise.resolve(deterministicEmbedding(text)),
  } as EmbeddingService;

  try {
    await dataSource.initialize();
    const createService = (configuration: RetrievalBenchmarkConfiguration) =>
      new RetrievalService(
        dataSource,
        embeddingService,
        createConfig(configuration),
      );
    const benchmark = await new RetrievalBenchmarkRunner(createService).run(
      dataset,
      options.topKValues,
      options.thresholds,
      options.strategies,
    );
    const comparisons = await Promise.all(
      benchmark.configurations.map(async (result) => {
        const evaluation = await new RetrievalEvaluationRunner(
          createService(result.configuration),
        ).run(dataset, [result.configuration.topK]);
        return createBaselineComparison(result, evaluation);
      }),
    );
    const bestBaseline = rankBaselineComparisons(comparisons)[0];
    const balancedConfigurations = rankBaselineComparisons(comparisons).map(
      (comparison) => ({
        ...comparison.result,
        noSourceAccuracy: comparison.noSourceAccuracy,
        balancedScore: comparison.balancedScore,
        failures: comparison.evaluation.cases
          .filter(isFailure)
          .map(summarizeFailure),
      }),
    );
    const strategyWinners = options.strategies.map((strategy) => {
      const winner = rankBaselineComparisons(
        comparisons.filter(
          (comparison) => comparison.result.configuration.strategy === strategy,
        ),
      )[0];
      return {
        strategy,
        ...winner.result,
        noSourceAccuracy: winner.noSourceAccuracy,
        balancedScore: winner.balancedScore,
        failures: winner.evaluation.cases
          .filter(isFailure)
          .map(summarizeFailure),
      };
    });
    const positiveMetricWinner = benchmark.configurations[0];
    const failures = bestBaseline.evaluation.cases
      .filter(isFailure)
      .map(summarizeFailure);
    const report = {
      benchmark,
      positiveMetricWinner,
      bestBaseline: {
        ...bestBaseline.result,
        noSourceAccuracy: bestBaseline.noSourceAccuracy,
        balancedScore: bestBaseline.balancedScore,
      },
      bestEvaluation: bestBaseline.evaluation,
      balancedConfigurations,
      strategyWinners,
      failures,
    };

    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(formatBenchmarkComparison(benchmark));
    console.log(
      `\nPositive-metric winner: ${configurationLabel(positiveMetricWinner)}`,
    );
    console.log(
      `Best balanced baseline: ${configurationLabel(bestBaseline.result)}`,
    );
    console.log(
      `Balanced score: ${(bestBaseline.balancedScore * 100).toFixed(2)}% (Recall and no-source accuracy)`,
    );
    console.log(
      `No-source accuracy: ${(bestBaseline.noSourceAccuracy * 100).toFixed(2)}%`,
    );
    console.log(`Failures: ${failures.length}`);
    for (const failure of failures.slice(0, 5)) {
      console.log(`- ${failure.id}: ${failure.reason}`);
    }
    for (const winner of strategyWinners) {
      console.log(
        `${winner.strategy} winner: ${configurationLabel(winner)}; balanced=${(winner.balancedScore * 100).toFixed(2)}%; failures=${winner.failures.length}`,
      );
    }
    console.log(`\nJSON report: ${options.outputPath}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function configurationLabel(result: RetrievalBenchmarkResult): string {
  return `${result.configuration.strategy}, topK=${result.configuration.topK}, threshold=${result.configuration.minimumSimilarity.toFixed(2)}`;
}

function createConfig(
  configuration: RetrievalBenchmarkConfiguration,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: (key: keyof EnvironmentVariables) =>
      key === 'RETRIEVAL_TOP_K'
        ? configuration.topK
        : key === 'RETRIEVAL_MIN_SIMILARITY'
          ? configuration.minimumSimilarity
          : configuration.strategy,
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function isFailure(evaluationCase: EvaluationCaseRun): boolean {
  if (evaluationCase.expectedSources.length === 0) {
    return evaluationCase.retrieved.length > 0;
  }
  return evaluationCase.expectedSources.some(
    (expected) =>
      !evaluationCase.retrieved.some((actual) =>
        sourceMatches(expected, actual),
      ),
  );
}

function summarizeFailure(evaluationCase: EvaluationCaseRun): {
  id: string;
  question: string;
  reason: string;
  retrieved: Array<
    Pick<RetrievalResultDto, 'filename' | 'pageNumber' | 'similarity'>
  >;
} {
  const negative = evaluationCase.expectedSources.length === 0;
  return {
    id: evaluationCase.id ?? evaluationCase.question,
    question: evaluationCase.question,
    reason: negative
      ? 'returned results for a no-relevant-source question'
      : 'one or more expected sources were not retrieved',
    retrieved: evaluationCase.retrieved.map(
      ({ filename, pageNumber, similarity }) => ({
        filename,
        pageNumber,
        similarity,
      }),
    ),
  };
}

function parseOptions(args: string[]): Options {
  return {
    datasetPath: resolve(
      optionValue(args, '--dataset') ??
        'evaluation/datasets/phase-4c-baseline.json',
    ),
    outputPath: resolve(
      optionValue(args, '--output') ??
        'evaluation-results/phase-4c-baseline.json',
    ),
    topKValues: numberList(optionValue(args, '--top-k') ?? '1,3,5,8'),
    thresholds: numberList(
      optionValue(args, '--thresholds') ?? '0,0.1,0.2,0.3',
    ),
    strategies: strategyList(
      optionValue(args, '--strategies') ?? 'vector,hybrid',
    ),
  };
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

function numberList(value: string): number[] {
  return value.split(',').map((item) => Number(item.trim()));
}

function strategyList(value: string): RetrievalStrategy[] {
  return value.split(',').map((item) => item.trim() as RetrievalStrategy);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Baseline benchmark failed: ${message}`);
  process.exitCode = 1;
});
