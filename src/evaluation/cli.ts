import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import dataSource from '../database/data-source';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { loadEvaluationDataset } from './dataset';
import { normalizeKValues } from './metrics';
import { createRetrievalConfig } from './retrieval-runtime';
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Retrieval evaluation failed: ${message}`);
  process.exitCode = 1;
});
