import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ENV_DEFAULTS, EnvironmentVariables } from '../config/environment';
import dataSource from '../database/data-source';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { loadEvaluationDataset } from './dataset';
import { normalizeKValues } from './metrics';
import {
  formatEvaluationSummary,
  RetrievalEvaluationRunner,
} from './retrieval-evaluation.runner';

interface CliOptions {
  datasetPath: string;
  outputPath: string;
  kValues: number[];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dataset = await loadEvaluationDataset(options.datasetPath);
  const maximumK = options.kValues.at(-1)!;
  const configService = createRetrievalConfig(maximumK);
  const embeddingService = new EmbeddingService(configService);
  const retrievalService = new RetrievalService(
    dataSource,
    embeddingService,
    configService,
  );

  try {
    await dataSource.initialize();
    const report = await new RetrievalEvaluationRunner(retrievalService).run(
      dataset,
      options.kValues,
    );
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(formatEvaluationSummary(report));
    console.log(`\nJSON report: ${options.outputPath}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function parseOptions(args: string[]): CliOptions {
  const datasetPath = resolve(
    optionValue(args, '--dataset') ?? 'evaluation/datasets/sample.json',
  );
  const outputPath = resolve(
    optionValue(args, '--output') ?? 'evaluation-results/retrieval.json',
  );
  const rawKValues = optionValue(args, '--k') ?? '1,3,5';
  const kValues = normalizeKValues(
    rawKValues.split(',').map((value) => Number(value.trim())),
  );
  return { datasetPath, outputPath, kValues };
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

function createRetrievalConfig(
  topK: number,
): ConfigService<EnvironmentVariables, true> {
  const values = {
    OPENAI_API_KEY: requiredEnvironmentValue('OPENAI_API_KEY'),
    EMBEDDING_MODEL:
      process.env.EMBEDDING_MODEL ?? ENV_DEFAULTS.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: integerEnvironmentValue(
      'EMBEDDING_DIMENSIONS',
      ENV_DEFAULTS.EMBEDDING_DIMENSIONS,
    ),
    RETRIEVAL_TOP_K: topK,
    RETRIEVAL_MIN_SIMILARITY: numberEnvironmentValue(
      'RETRIEVAL_MIN_SIMILARITY',
      ENV_DEFAULTS.RETRIEVAL_MIN_SIMILARITY,
    ),
  };
  return {
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function requiredEnvironmentValue(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for retrieval evaluation`);
  return value;
}

function integerEnvironmentValue(key: string, fallback: number): number {
  const value = process.env[key];
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function numberEnvironmentValue(key: string, fallback: number): number {
  const value = process.env[key];
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1) {
    throw new Error(`${key} must be a number between -1 and 1`);
  }
  return parsed;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Retrieval evaluation failed: ${message}`);
  process.exitCode = 1;
});
