import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import dataSource from '../database/data-source';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalStrategy } from '../retrieval/retrieval-strategy';
import { loadEvaluationDataset } from './dataset';
import {
  formatBenchmarkComparison,
  RetrievalBenchmarkRunner,
} from './retrieval-benchmark.runner';
import {
  createCachedEmbeddingService,
  createRetrievalConfig,
} from './retrieval-runtime';

interface BenchmarkCliOptions {
  datasetPath: string;
  outputPath: string;
  topKValues: number[];
  similarityThresholds: number[];
  strategies: RetrievalStrategy[];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dataset = await loadEvaluationDataset(options.datasetPath);
  const baseConfig = createRetrievalConfig(
    Math.max(...options.topKValues),
    options.similarityThresholds[0],
  );
  const cachedEmbeddingService = createCachedEmbeddingService(
    new EmbeddingService(baseConfig),
  );

  try {
    await dataSource.initialize();
    const report = await new RetrievalBenchmarkRunner((configuration) => {
      const config = createRetrievalConfig(
        configuration.topK,
        configuration.minimumSimilarity,
        configuration.strategy,
      );
      return new RetrievalService(dataSource, cachedEmbeddingService, config);
    }).run(
      dataset,
      options.topKValues,
      options.similarityThresholds,
      options.strategies,
    );

    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(formatBenchmarkComparison(report));
    console.log(`\nJSON report: ${options.outputPath}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function parseOptions(args: string[]): BenchmarkCliOptions {
  return {
    datasetPath: resolve(
      optionValue(args, '--dataset') ?? 'evaluation/datasets/sample.json',
    ),
    outputPath: resolve(
      optionValue(args, '--output') ?? 'evaluation-results/benchmark.json',
    ),
    topKValues: numberList(optionValue(args, '--top-k') ?? '1,3,5'),
    similarityThresholds: numberList(
      optionValue(args, '--thresholds') ?? '0.3,0.5,0.7',
    ),
    strategies: strategyList(optionValue(args, '--strategies') ?? 'vector'),
  };
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
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
  console.error(`Retrieval benchmark failed: ${message}`);
  process.exitCode = 1;
});
