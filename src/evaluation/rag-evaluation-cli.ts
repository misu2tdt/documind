import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { ENV_DEFAULTS, EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { GenerationService } from '../questions/generation.service';
import { QuestionsService } from '../questions/questions.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalStrategy } from '../retrieval/retrieval-strategy';
import { loadEvaluationDataset } from './dataset';
import { deterministicEmbedding } from './deterministic-embedding';
import { createEvaluationDataSource } from './evaluation-data-source';
import {
  RagEvaluationReport,
  RagEvaluationRunner,
} from './rag-evaluation.runner';

interface Options {
  datasetPath: string;
  outputPath: string;
  strategy: RetrievalStrategy;
  topK: number;
  minimumSimilarity: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes('--live')) {
    throw new Error(
      'Live RAG evaluation calls Anthropic; rerun with --live to confirm',
    );
  }
  const options = parseOptions(args);
  const dataset = await loadEvaluationDataset(options.datasetPath);
  const dataSource = createEvaluationDataSource();
  const config = createConfig(options);
  const embeddingService = {
    embedOne: (text: string) => Promise.resolve(deterministicEmbedding(text)),
  } as EmbeddingService;

  try {
    await dataSource.initialize();
    const retrievalService = new RetrievalService(
      dataSource,
      embeddingService,
      config,
    );
    const questionsService = new QuestionsService(
      retrievalService,
      new GenerationService(config),
    );
    const report = await new RagEvaluationRunner(
      retrievalService,
      questionsService,
    ).run(dataset, options.topK);

    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(
      options.outputPath,
      `${JSON.stringify({ configuration: options, ...report }, null, 2)}\n`,
    );
    console.log(formatRagSummary(report));
    console.log(`\nJSON report: ${options.outputPath}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function createConfig(
  options: Options,
): ConfigService<EnvironmentVariables, true> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (
    !anthropicApiKey ||
    anthropicApiKey.length < 12 ||
    /your|test|placeholder/i.test(anthropicApiKey)
  ) {
    throw new Error('A usable ANTHROPIC_API_KEY is required');
  }
  const values = {
    ANTHROPIC_API_KEY: anthropicApiKey,
    GENERATION_MODEL:
      process.env.GENERATION_MODEL ?? ENV_DEFAULTS.GENERATION_MODEL,
    GENERATION_MAX_TOKENS: numericEnvironmentValue(
      'GENERATION_MAX_TOKENS',
      ENV_DEFAULTS.GENERATION_MAX_TOKENS,
    ),
    GENERATION_CONTEXT_MAX_CHARS: numericEnvironmentValue(
      'GENERATION_CONTEXT_MAX_CHARS',
      ENV_DEFAULTS.GENERATION_CONTEXT_MAX_CHARS,
    ),
    RETRIEVAL_TOP_K: options.topK,
    RETRIEVAL_MIN_SIMILARITY: options.minimumSimilarity,
    RETRIEVAL_STRATEGY: options.strategy,
  };
  return {
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function parseOptions(args: string[]): Options {
  const strategy = optionValue(args, '--strategy') ?? 'hybrid';
  if (strategy !== 'vector' && strategy !== 'hybrid') {
    throw new Error('--strategy must be vector or hybrid');
  }
  return {
    datasetPath: resolve(
      optionValue(args, '--dataset') ??
        'evaluation/datasets/phase-4c-baseline.json',
    ),
    outputPath: resolve(
      optionValue(args, '--output') ??
        'evaluation-results/phase-4g-rag-live.json',
    ),
    strategy,
    topK: numericOption(args, '--top-k', 3, 1, 100),
    minimumSimilarity: numericOption(args, '--threshold', 0.2, -1, 1),
  };
}

export function formatRagSummary(report: RagEvaluationReport): string {
  const retrieval = report.retrieval.metrics[0];
  const generation = report.generation.metrics;
  return [
    `Live RAG evaluation: ${report.dataset}`,
    '',
    'Retrieval metrics',
    `Hit Rate@${retrieval.k}: ${percent(retrieval.hitRate)}`,
    `Recall@${retrieval.k}: ${percent(retrieval.recall)}`,
    `MRR@${retrieval.k}: ${retrieval.mrr.toFixed(4)}`,
    '',
    'Generation and citation metrics',
    `Citation precision: ${percent(generation.citationPrecision)}`,
    `Citation recall: ${percent(generation.citationRecall)}`,
    `Source correctness: ${percent(generation.sourceCorrectness)}`,
    `Page correctness: ${percent(generation.pageCorrectness)}`,
    `No-source accuracy: ${percent(generation.noSourceAccuracy)}`,
  ].join('\n');
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

function numericOption(
  args: string[],
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = optionValue(args, name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function numericEnvironmentValue(key: string, fallback: number): number {
  const raw = process.env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${key} must be a positive number`);
  }
  return value;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Live RAG evaluation failed: ${message}`);
  process.exitCode = 1;
});
