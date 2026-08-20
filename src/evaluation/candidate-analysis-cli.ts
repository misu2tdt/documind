import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalStrategy } from '../retrieval/retrieval-strategy';
import {
  CandidateAnalysisRunner,
  CandidateAnalysisReport,
} from './candidate-analysis';
import { loadEvaluationDataset } from './dataset';
import { deterministicEmbedding } from './deterministic-embedding';
import { createEvaluationDataSource } from './evaluation-data-source';

async function main(): Promise<void> {
  const outputPath = resolve(
    optionValue(process.argv.slice(2), '--output') ??
      'evaluation-results/phase-4e-candidates.json',
  );
  const dataset = await loadEvaluationDataset(
    resolve('evaluation/datasets/phase-4c-baseline.json'),
  );
  const dataSource = createEvaluationDataSource();
  const embeddingService = {
    embedOne: (text: string) => Promise.resolve(deterministicEmbedding(text)),
  } as EmbeddingService;

  try {
    await dataSource.initialize();
    const report = await new CandidateAnalysisRunner(
      dataSource,
      embeddingService,
      (strategy, minimumSimilarity) =>
        new RetrievalService(
          dataSource,
          embeddingService,
          createConfig(strategy, minimumSimilarity),
        ),
    ).run(dataset, [5, 10, 20], [-1, 0, 0.1, 0.2]);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(formatCandidateAnalysis(report));
    console.log(`\nJSON report: ${outputPath}`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

function createConfig(
  strategy: RetrievalStrategy,
  minimumSimilarity: number,
): ConfigService<EnvironmentVariables, true> {
  return {
    get: (key: keyof EnvironmentVariables) => {
      if (key === 'RETRIEVAL_TOP_K') return 20;
      if (key === 'RETRIEVAL_MIN_SIMILARITY') return minimumSimilarity;
      return strategy;
    },
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

export function formatCandidateAnalysis(
  report: CandidateAnalysisReport,
): string {
  const lines = [
    `Candidate analysis: ${report.dataset}`,
    '',
    'Strategy\tThreshold\tRecall@5\tRecall@10\tRecall@20',
  ];
  for (const result of report.candidateRecall) {
    lines.push(
      `${result.strategy}\t${result.minimumSimilarity.toFixed(2)}\t\t${result.metrics.map((metric) => percent(metric.recall)).join('\t\t')}`,
    );
  }
  lines.push(
    '',
    `Failed cases at hybrid topK=${report.baseline.topK}, threshold=${report.baseline.minimumSimilarity.toFixed(2)}:`,
  );
  for (const failure of report.failures) {
    lines.push(`- ${failure.id}: ${failure.cause}`);
    for (const relevant of failure.relevant) {
      lines.push(
        `  vector rank=${value(relevant.vectorRank)}, similarity=${value(relevant.vectorSimilarity)}, lexical raw/guarded=${value(relevant.rawLexicalRank)}/${value(relevant.guardedLexicalRank)}, terms=${relevant.lexicalMatchedTerms}/${relevant.lexicalQueryTerms}, query rejected=${relevant.rejectedByLexicalQuery}, hybrid rank=${value(relevant.hybridRank)}`,
      );
    }
  }
  return lines.join('\n');
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function value(input: number | null): string {
  return input === null ? 'absent' : String(input);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Candidate analysis failed: ${message}`);
  process.exitCode = 1;
});
